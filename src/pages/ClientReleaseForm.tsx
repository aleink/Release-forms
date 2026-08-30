import { FormEvent, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { CalendarDays, Check, ChevronLeft, ChevronRight, FileCheck, MapPin, ShieldCheck, UserRound } from "lucide-react";
import { calculateAge, isMinor } from "../lib/age";
import {
  clientFieldsFor,
  companyReleaseText,
  requirementLocations,
  staffFieldsFor,
  standardDocuments,
  type RequirementField,
  type ServiceType,
} from "../data/requirements";
import { FieldRenderer } from "../components/FieldRenderer";
import { ProgressRail } from "../components/ProgressRail";
import { isReleaseFormDemoMode, submitPublicReleaseForm } from "../lib/supabase";

const steps = ["Appointment", "Info", "Health", "Sign"];

const demoAppointment = {
  locationId: "las_vegas",
  serviceType: "tattoo" as ServiceType,
  dateOfService: "2026-05-13",
  artistName: "Demo Artist",
  serviceLabel: "Demo tattoo appointment",
  bodyArea: "Demo placement",
  priceSummary: "Demo estimate",
  firstName: "Demo",
  lastName: "Client",
  phone: "+1 (555) 010-0100",
};

const conditionOptions = [
  { id: "hypoglycemic", label: "Hypoglycemic" },
  { id: "latex_lidocaine_allergy", label: "Latex or lidocaine allergy" },
  { id: "jaundice", label: "Jaundice" },
  { id: "seizures_epilepsy_narcolepsy", label: "Seizures, epilepsy, or narcolepsy" },
  { id: "diabetic_anemic_hemophiliac", label: "Diabetic, anemic, or hemophiliac" },
  { id: "receiving_dialysis", label: "Receiving dialysis" },
  { id: "skin_sensitivity", label: "Skin sensitivity" },
  { id: "prone_to_fainting", label: "Prone to fainting" },
  { id: "hiv_hepatitis", label: "HIV or hepatitis A/B" },
  { id: "other", label: "Other" },
];

type ValueMap = Record<string, string | boolean | File | null>;

export function ClientReleaseForm() {
  const { token } = useParams();
  const [step, setStep] = useState(0);
  const [locationId] = useState(demoAppointment.locationId);
  const [serviceType] = useState<ServiceType>(demoAppointment.serviceType);
  const [values, setValues] = useState<ValueMap>({
    date_of_service: demoAppointment.dateOfService,
    first_name: demoAppointment.firstName,
    last_name: demoAppointment.lastName,
    phone: demoAppointment.phone,
  });
  const [submitting, setSubmitting] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const location = requirementLocations.find((item) => item.id === locationId) ?? requirementLocations[0];
  const age = calculateAge(String(values.dob ?? ""));
  const minor = isMinor(String(values.dob ?? ""), location.adultAge);
  const clientProcedureFields = clientFieldsFor(locationId, serviceType);
  const staffRequiredFields = staffFieldsFor(locationId, serviceType);
  const selectedConditionIds = String(values.health_conditions ?? "").split(",").filter(Boolean);
  const appointmentSummary = {
    location: location.name,
    service: demoAppointment.serviceLabel,
    serviceType,
    date: String(values.date_of_service ?? demoAppointment.dateOfService),
    artist: demoAppointment.artistName,
    bodyArea: demoAppointment.bodyArea,
    price: demoAppointment.priceSummary,
  };

  const documentFields = useMemo(
    () => standardDocuments.filter((field) => minor || (!field.id.includes("guardian") && !field.id.includes("minor"))),
    [minor],
  );

  const blockedDemoLink = token === "demo" && !isReleaseFormDemoMode;

  const setField = (id: string, value: string | boolean | File | null) => {
    setValues((previous) => ({ ...previous, [id]: value }));
  };

  const setCondition = (id: string, enabled: boolean) => {
    const next = enabled
      ? Array.from(new Set([...selectedConditionIds, id]))
      : selectedConditionIds.filter((conditionId) => conditionId !== id);
    setField("health_conditions", next.join(","));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const documents = documentFields
        .map((field) => {
          const value = values[field.id];
          if (!(value instanceof File)) {
            return null;
          }

          return {
            field_id: field.id,
            label: field.label,
            file_name: value.name,
            mime_type: value.type || "application/octet-stream",
            size: value.size,
          };
        })
        .filter(Boolean);

      const payload = {
        token,
        location_id: locationId,
        requirement_version: "seed-2026-05-13",
        service_type: serviceType,
        appointment: appointmentSummary,
        client: {
          first_name: values.first_name,
          last_name: values.last_name,
          phone: values.phone,
          email: values.email,
          dob: values.dob,
          age_at_submission: age,
          address: values.address,
        },
        procedure: {
          client_supplied: Object.fromEntries(clientProcedureFields.map((field) => [field.id, values[field.id] ?? null])),
          staff_required: staffRequiredFields.map(({ id, label, required }) => ({ id, label, required })),
        },
        health: {
          not_intoxicated: values.not_intoxicated === true,
          not_pregnant_or_nursing: values.not_pregnant_or_nursing === true,
          nsaids_last_24h: values.nsaids_last_24h ?? null,
          eaten_last_4h: values.eaten_last_4h ?? null,
          skin_disease_history: values.skin_disease_history ?? null,
          listed_conditions_apply: values.listed_conditions_apply ?? null,
          health_conditions: selectedConditionIds,
          other_condition_notes: values.other_condition_notes ?? null,
        },
        documents,
        minor: minor ? {
          guardian_name: values.guardian_name,
          guardian_phone: values.guardian_phone,
          guardian_email: values.guardian_email,
          guardian_address: values.guardian_address,
        } : null,
        signatures: {
          client_signature: values.client_signature,
          guardian_signature: minor ? values.guardian_signature : null,
          service_acknowledged: values.service_acknowledged === true,
          accepted_release: values.accepted_release === true,
        },
        submitted_at: new Date().toISOString(),
      };
      const result = await submitPublicReleaseForm(token, payload);
      setSubmittedId(String((result as { id?: string })?.id ?? "submitted"));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (blockedDemoLink) {
    return (
      <main className="client-shell success-state">
        <section className="success-panel">
          <ShieldCheck size={30} />
          <h1>Release form unavailable</h1>
          <p>This demo link is disabled. Please request a current release-form link from the studio.</p>
        </section>
      </main>
    );
  }

  if (submittedId) {
    return (
      <main className="client-shell success-state">
        <section className="success-panel">
          <div className="success-icon"><FileCheck size={30} /></div>
          <h1>Release form submitted</h1>
          <p>Submission ID: {submittedId}</p>
          <p>The studio can review this from the staff dashboard after login.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="client-shell">
      <aside className="client-aside">
        <div className="brand-lockup">
          <span>Club Tattoo</span>
          <strong>Release Form</strong>
        </div>
        <ProgressRail steps={steps} currentStep={step} />
        <div className="compliance-card">
          <ShieldCheck size={18} />
          <span>{location.jurisdiction}</span>
        </div>
      </aside>

      <form className="release-card" onSubmit={submit}>
        {step === 0 && (
          <section className="step-panel">
            <p className="eyebrow">Appointment</p>
            <h1>Look over your appointment.</h1>
            <AppointmentSummary summary={appointmentSummary} />
            {clientProcedureFields.length > 0 && (
              <div className="local-fields">
                <h2>Needed for this location</h2>
                <div className="field-grid two">
                  {clientProcedureFields.map((field) => (
                    <FieldRenderer key={field.id} field={field} value={values[field.id]} onChange={(value) => setField(field.id, value)} />
                  ))}
                </div>
              </div>
            )}
            <FieldRenderer field={{ id: "service_acknowledged", label: "These appointment details look correct.", type: "checkbox", required: true }} value={values.service_acknowledged} onChange={(value) => setField("service_acknowledged", value)} />
          </section>
        )}

        {step === 1 && (
          <section className="step-panel compact-step">
            <p className="eyebrow">Info</p>
            <h1>Basic info.</h1>
            <div className="field-grid two">
              <FieldRenderer field={{ id: "first_name", label: "First name", type: "text", required: true }} value={values.first_name} onChange={(value) => setField("first_name", value)} />
              <FieldRenderer field={{ id: "last_name", label: "Last name", type: "text", required: true }} value={values.last_name} onChange={(value) => setField("last_name", value)} />
              <label className="field">
                <span className="field-label">Verified phone</span>
                <input value={String(values.phone ?? "")} readOnly />
              </label>
              <FieldRenderer field={{ id: "email", label: "Email", type: "text", required: true }} value={values.email} onChange={(value) => setField("email", value)} />
              <FieldRenderer field={{ id: "dob", label: "Date of birth", type: "date", required: true }} value={values.dob} onChange={(value) => setField("dob", value)} />
              <label className="field calculated">
                <span className="field-label">Age</span>
                <output>{age === null ? "Waiting for DOB" : `${age} years old`}</output>
              </label>
              <label className="field field-wide">
                <span className="field-label">Home address <span className="required-mark">*</span></span>
                <input value={String(values.address ?? "")} onChange={(event) => setField("address", event.target.value)} required />
              </label>
            </div>
            {minor && (
              <div className="minor-panel">
                <strong>Parent or legal guardian required</strong>
                <p>{location.minorRules[0]}</p>
                <div className="field-grid two">
                  <FieldRenderer field={{ id: "guardian_name", label: "Parent or guardian name", type: "text", required: true }} value={values.guardian_name} onChange={(value) => setField("guardian_name", value)} />
                  <FieldRenderer field={{ id: "guardian_phone", label: "Parent or guardian phone", type: "phone", required: true }} value={values.guardian_phone} onChange={(value) => setField("guardian_phone", value)} />
                  <FieldRenderer field={{ id: "guardian_email", label: "Parent or guardian email", type: "text", required: true }} value={values.guardian_email} onChange={(value) => setField("guardian_email", value)} />
                  <FieldRenderer field={{ id: "guardian_address", label: "Parent or guardian address", type: "text", required: true }} value={values.guardian_address} onChange={(value) => setField("guardian_address", value)} />
                </div>
              </div>
            )}
            <div className="field-grid">
              {documentFields.map((field) => (
                <FieldRenderer key={field.id} field={field} value={values[field.id]} onChange={(value) => setField(field.id, value)} />
              ))}
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="step-panel compact-step">
            <p className="eyebrow">Health</p>
            <h1>Quick health check.</h1>
            <div className="health-stack">
              <FieldRenderer field={{ id: "not_intoxicated", label: "I am not under the influence of alcohol or drugs.", type: "checkbox", required: true }} value={values.not_intoxicated} onChange={(value) => setField("not_intoxicated", value)} />
              <FieldRenderer field={{ id: "not_pregnant_or_nursing", label: "I am not pregnant or nursing, if applicable.", type: "checkbox", required: true }} value={values.not_pregnant_or_nursing} onChange={(value) => setField("not_pregnant_or_nursing", value)} />
              <ChoiceGroup label="Taken NSAIDs, antiplatelet, or anticoagulant drugs in the last 24 hours?" value={values.nsaids_last_24h} onChange={(value) => setField("nsaids_last_24h", value)} options={["No", "Yes"]} />
              <ChoiceGroup label="Eaten in the past 4 hours?" value={values.eaten_last_4h} onChange={(value) => setField("eaten_last_4h", value)} options={["Yes", "No"]} />
              <ChoiceGroup label="Any skin disease or medication history that might affect healing?" value={values.skin_disease_history} onChange={(value) => setField("skin_disease_history", value)} options={["No", "Yes"]} />
              <ChoiceGroup label="Do any listed conditions apply?" value={values.listed_conditions_apply} onChange={(value) => setField("listed_conditions_apply", value)} options={["No", "Yes"]} />
              {values.listed_conditions_apply === "Yes" && (
                <ConditionChecklist selected={selectedConditionIds} onToggle={setCondition} />
              )}
              {selectedConditionIds.includes("other") && (
                <FieldRenderer field={{ id: "other_condition_notes", label: "Other condition notes", type: "textarea", required: true }} value={values.other_condition_notes} onChange={(value) => setField("other_condition_notes", value)} />
              )}
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="step-panel compact-step">
            <p className="eyebrow">Sign</p>
            <h1>Sign once to submit.</h1>
            <AppointmentSummary summary={appointmentSummary} compact />
            <details className="release-details">
              <summary>Release terms</summary>
              <div className="release-copy">
                {companyReleaseText.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
            </details>
            <FieldRenderer field={{ id: "client_signature", label: "Electronic signature", type: "signature", required: true, helper: "Type your full legal name." }} value={values.client_signature} onChange={(value) => setField("client_signature", value)} />
            {minor && (
              <FieldRenderer field={{ id: "guardian_signature", label: "Parent or guardian electronic signature", type: "signature", required: true, helper: "Type full legal name." }} value={values.guardian_signature} onChange={(value) => setField("guardian_signature", value)} />
            )}
            <FieldRenderer field={{ id: "accepted_release", label: "I confirm the information is true and I accept the release terms.", type: "checkbox", required: true }} value={values.accepted_release} onChange={(value) => setField("accepted_release", value)} />
            {error && <div className="error-banner">{error}</div>}
          </section>
        )}

        <footer className="form-nav">
          <button type="button" className="secondary-button" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
            <ChevronLeft size={18} /> Back
          </button>
          {step < steps.length - 1 ? (
            <button type="button" className="primary-button" onClick={() => setStep(Math.min(steps.length - 1, step + 1))}>
              Continue <ChevronRight size={18} />
            </button>
          ) : (
            <button type="submit" className="primary-button" disabled={submitting || values.accepted_release !== true}>
              <Check size={18} /> {submitting ? "Submitting" : "Submit release"}
            </button>
          )}
        </footer>
      </form>
    </main>
  );
}

interface AppointmentSummaryProps {
  compact?: boolean;
  summary: {
    location: string;
    service: string;
    serviceType: ServiceType;
    date: string;
    artist: string;
    bodyArea: string;
    price: string;
  };
}

function AppointmentSummary({ compact = false, summary }: AppointmentSummaryProps) {
  return (
    <div className={`appointment-summary${compact ? " compact" : ""}`}>
      <SummaryItem icon={<MapPin size={18} />} label="Location" value={summary.location} />
      <SummaryItem icon={<CalendarDays size={18} />} label="Date" value={summary.date} />
      <SummaryItem icon={<UserRound size={18} />} label="Artist" value={summary.artist} />
      <SummaryItem label="Service" value={summary.service} />
      <SummaryItem label="Area" value={summary.bodyArea} />
      <SummaryItem label="Price" value={summary.price} />
    </div>
  );
}

function SummaryItem({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="summary-item">
      <span>{icon}{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ChoiceGroup({ label, value, onChange, options }: { label: string; value: string | boolean | File | null | undefined; onChange: (value: string) => void; options: string[] }) {
  return (
    <div className="choice-group">
      <span className="field-label">{label} <span className="required-mark">*</span></span>
      <div className="choice-buttons">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={value === option ? "choice-button selected" : "choice-button"}
            onClick={() => onChange(option)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function ConditionChecklist({ selected, onToggle }: { selected: string[]; onToggle: (id: string, enabled: boolean) => void }) {
  return (
    <div className="condition-list">
      {conditionOptions.map((condition) => (
        <label key={condition.id} className="condition-chip">
          <input
            type="checkbox"
            checked={selected.includes(condition.id)}
            onChange={(event) => onToggle(condition.id, event.target.checked)}
          />
          <span>{condition.label}</span>
        </label>
      ))}
    </div>
  );
}
