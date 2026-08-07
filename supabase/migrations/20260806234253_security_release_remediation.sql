-- DS-002 / DS-003: make the public release submission capability single-use
-- and validate the legal record at the database trust boundary.

BEGIN;

ALTER TABLE public.release_form_links
  ADD COLUMN IF NOT EXISTS service_type public.service_type;

UPDATE public.release_form_links
SET service_type = CASE
  WHEN client_hint ->> 'service_type' = 'piercing' THEN 'piercing'::public.service_type
  ELSE 'tattoo'::public.service_type
END
WHERE service_type IS NULL;

ALTER TABLE public.release_form_links
  ALTER COLUMN service_type SET DEFAULT 'tattoo'::public.service_type,
  ALTER COLUMN service_type SET NOT NULL;

-- A trigger can be installed even when historic duplicate legal records need
-- manual review. The advisory lock also closes concurrent non-RPC inserts
-- without deleting or rewriting existing evidence.
CREATE OR REPLACE FUNCTION public.reject_duplicate_release_link_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.link_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.link_id::text, 0));
  IF EXISTS (
    SELECT 1
    FROM public.release_forms existing
    WHERE existing.link_id = NEW.link_id
  ) THEN
    RAISE EXCEPTION 'Release form link has already been submitted'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS release_forms_one_submission_per_link_t
  ON public.release_forms;
CREATE TRIGGER release_forms_one_submission_per_link_t
BEFORE INSERT ON public.release_forms
FOR EACH ROW
EXECUTE FUNCTION public.reject_duplicate_release_link_submission();

CREATE OR REPLACE FUNCTION public.submit_public_release_form(
  p_token text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_link public.release_form_links%rowtype;
  v_requirement public.requirement_versions%rowtype;
  v_form_id uuid;
  v_dob date;
  v_age integer;
  v_is_minor boolean;
  v_procedure_fields jsonb;
  v_procedure_value jsonb;
  v_staff_required jsonb;
  v_field jsonb;
  v_required_guardian_keys text[] := ARRAY[
    'guardian_name', 'guardian_phone', 'guardian_email', 'guardian_address'
  ];
  v_key text;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid release form submission'
      USING ERRCODE = '22023';
  END IF;

  -- Claim before validating/inserting. Any later exception rolls this statement
  -- back, while racing/replayed calls deterministically update zero rows.
  UPDATE public.release_form_links
  SET used_at = now()
  WHERE token_hash = public.hash_release_token(p_token)
    AND used_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
  RETURNING * INTO v_link;

  IF v_link.id IS NULL THEN
    RAISE EXCEPTION 'Invalid, expired, or already used release form link'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_link.requirement_version_id IS NOT NULL THEN
    SELECT * INTO v_requirement
    FROM public.requirement_versions rv
    WHERE rv.id = v_link.requirement_version_id
      AND rv.location_id = v_link.location_id;
  ELSE
    SELECT * INTO v_requirement
    FROM public.requirement_versions rv
    WHERE rv.location_id = v_link.location_id
      AND rv.effective_at <= now()
      AND (rv.retired_at IS NULL OR rv.retired_at > now())
    ORDER BY rv.effective_at DESC
    LIMIT 1;
  END IF;

  IF v_requirement.id IS NULL THEN
    RAISE EXCEPTION 'No active release requirements are configured for this location'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_payload -> 'client') <> 'object'
     OR jsonb_typeof(p_payload -> 'procedure') <> 'object'
     OR jsonb_typeof(p_payload #> '{procedure,client_supplied}') <> 'object'
     OR jsonb_typeof(p_payload -> 'health') <> 'object'
     OR jsonb_typeof(p_payload -> 'signatures') <> 'object' THEN
    RAISE EXCEPTION 'Required release sections are missing'
      USING ERRCODE = '22023';
  END IF;

  FOREACH v_key IN ARRAY ARRAY['first_name', 'last_name', 'phone', 'email', 'dob', 'address'] LOOP
    IF length(btrim(coalesce(p_payload #>> ARRAY['client', v_key], ''))) = 0 THEN
      RAISE EXCEPTION 'Required client field is missing: %', v_key
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  BEGIN
    v_dob := (p_payload #>> '{client,dob}')::date;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'Client date of birth is invalid'
      USING ERRCODE = '22007';
  END;
  IF v_dob > current_date OR v_dob < current_date - interval '120 years' THEN
    RAISE EXCEPTION 'Client date of birth is outside the accepted range'
      USING ERRCODE = '22023';
  END IF;
  v_age := extract(year FROM age(current_date, v_dob));
  v_is_minor := v_age < v_requirement.adult_age;

  v_procedure_fields := coalesce(v_requirement.standard_fields, '[]'::jsonb)
    || CASE v_link.service_type
         WHEN 'piercing'::public.service_type THEN coalesce(v_requirement.piercing_fields, '[]'::jsonb)
         ELSE coalesce(v_requirement.tattoo_fields, '[]'::jsonb)
       END;
  FOR v_field IN
    SELECT value
    FROM jsonb_array_elements(v_procedure_fields)
  LOOP
    IF v_field ->> 'audience' = 'client'
       AND coalesce((v_field ->> 'required')::boolean, false) THEN
      v_procedure_value := p_payload #> ARRAY[
        'procedure', 'client_supplied', v_field ->> 'id'
      ];
      IF v_procedure_value IS NULL
         OR v_procedure_value = 'null'::jsonb
         OR (
           jsonb_typeof(v_procedure_value) = 'string'
           AND length(btrim(v_procedure_value #>> '{}')) = 0
         ) THEN
        RAISE EXCEPTION 'Required procedure field is missing: %', v_field ->> 'id'
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;

  SELECT coalesce(
    jsonb_agg(jsonb_build_object(
      'id', field ->> 'id',
      'label', field ->> 'label',
      'required', true
    )),
    '[]'::jsonb
  ) INTO v_staff_required
  FROM jsonb_array_elements(v_procedure_fields) field
  WHERE field ->> 'audience' = 'staff'
    AND coalesce((field ->> 'required')::boolean, false);

  IF coalesce((p_payload #>> '{health,not_intoxicated}')::boolean, false) IS NOT TRUE
     OR coalesce((p_payload #>> '{health,not_pregnant_or_nursing}')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Required health attestations were not accepted'
      USING ERRCODE = '22023';
  END IF;

  FOREACH v_key IN ARRAY ARRAY[
    'nsaids_last_24h', 'eaten_last_4h', 'skin_disease_history', 'listed_conditions_apply'
  ] LOOP
    IF NOT (p_payload -> 'health' ? v_key)
       OR p_payload #> ARRAY['health', v_key] = 'null'::jsonb THEN
      RAISE EXCEPTION 'Required health answer is missing: %', v_key
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF length(btrim(coalesce(p_payload #>> '{signatures,client_signature}', ''))) = 0
     OR coalesce((p_payload #>> '{signatures,service_acknowledged}')::boolean, false) IS NOT TRUE
     OR coalesce((p_payload #>> '{signatures,accepted_release}')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Required signature or consent is missing'
      USING ERRCODE = '22023';
  END IF;

  IF v_is_minor THEN
    IF jsonb_typeof(p_payload -> 'minor') <> 'object' THEN
      RAISE EXCEPTION 'Guardian information is required for a minor'
        USING ERRCODE = '22023';
    END IF;
    FOREACH v_key IN ARRAY v_required_guardian_keys LOOP
      IF length(btrim(coalesce(p_payload #>> ARRAY['minor', v_key], ''))) = 0 THEN
        RAISE EXCEPTION 'Required guardian field is missing: %', v_key
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
    IF length(btrim(coalesce(p_payload #>> '{signatures,guardian_signature}', ''))) = 0 THEN
      RAISE EXCEPTION 'Guardian signature is required for a minor'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.release_forms (
    location_id,
    requirement_version_id,
    link_id,
    service_type,
    client,
    age_at_submission,
    guardian,
    procedure,
    health,
    signatures
  ) VALUES (
    v_link.location_id,
    v_requirement.id,
    v_link.id,
    v_link.service_type,
    p_payload -> 'client',
    v_age,
    CASE WHEN v_is_minor THEN p_payload -> 'minor' ELSE NULL END,
    jsonb_build_object(
      'client_supplied', p_payload #> '{procedure,client_supplied}',
      'staff_required', v_staff_required
    ),
    p_payload -> 'health',
    p_payload -> 'signatures'
  )
  RETURNING id INTO v_form_id;

  RETURN jsonb_build_object('id', v_form_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_public_release_form(text, jsonb)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_public_release_form(text, jsonb)
  TO anon, authenticated;

COMMIT;
