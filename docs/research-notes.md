# Release Form Research Notes

These notes summarize the source material used for the initial requirement engine. They are implementation notes, not legal advice.

## Internal Documents

- `Adult_Release_Form.pdf`: Standard adult client release, health declaration, government ID image, release signature, terms and conditions signature.
- `Minor_Release_Form.pdf`: Standard minor flow with client fields, guardian release signature, birth certificate, guardian ID, guardian contact details, and guardian consent language.
- `Release Form Requirements.xlsx`: Location-specific add-on fields for Miami, Houston, Las Vegas, and New Jersey.
- Location add-on PDFs: Confirm the same field lists as the workbook.

## Standard Company Fields

- Client name, phone, email, billing/contact address, DOB, gender.
- Auto-calculate age from DOB and store `age_at_submission`.
- Government-issued ID upload.
- Health declarations for intoxication, pregnancy/nursing, NSAIDS/anticoagulants, eating in last 4 hours, relevant health conditions, and skin disease history.
- Client release signature and terms signature.
- Minor flow: guardian identity, guardian ID, proof of guardianship or birth certificate where required, guardian signature.

## Location Add-Ons

### Miami

Piercing:
- Emergency contact name, phone, address.
- Physician name, phone, address.
- Race.
- Piercer name and signature.
- Piercing type.
- Jewelry type used.

Tattoo:
- Race.
- Artist name and signature.

Official Florida sources:
- Tattoo minor consent form: https://www.floridahealth.gov/environmental-health/tattooing/_documents/Notarized_Minor_Consent.pdf
- Body piercing customer record: https://www.floridahealth.gov/environmental-health/body-piercing/_documents/customer.pdf
- Body piercing minor consent: https://www.floridahealth.gov/environmental-health/body-piercing/consent.pdf

### Houston

Piercing:
- Piercing type.
- Jewelry type used.
- Piercer name.

Tattoo:
- Ink colors used.
- Ink lot numbers.
- Location on body.
- Artist name.

Official Texas source:
- Texas DSHS tattoo/body piercing licensing requirements: https://www.dshs.texas.gov/tattoo-body-piercing-studios/licensing-requirements-tattoo-body-piercing-studios

### Las Vegas

Piercing:
- Piercing type.
- Jewelry type used.
- Piercer name and signature.

Tattoo:
- Ink colors used.
- Ink lot numbers.
- Ink expiration dates.
- Needle expiration dates.
- Needle lot numbers.
- Location on body.
- Artist name and signature.
- Design.

Official Southern Nevada sources:
- Tattoo patron records: https://www.southernnevadahealthdistrict.org/permits-and-regulations/body-art/regulations/southern-nevada-health-district-regulations-governing-the-sanitation-and-safety-of-tattoo-establishments/section-7-patrons/
- Body piercing regulations: https://media.southernnevadahealthdistrict.org/download/body-art/20190710-body-piercing-regs.pdf

### New Jersey

Piercing:
- Piercing type.
- Piercer name.
- Emergency contact name and phone number.

Tattoo:
- Location on body.
- Artist name.
- Emergency contact name and phone number.

Official New Jersey source:
- N.J.A.C. 8:27-4.2 client records: https://www.nj.gov/health/ceohs/documents/phfpp/NJAC_8_27-4.pdf

## Design Decisions

- Requirement profiles must be versioned.
- Staff access must be scoped by location in Postgres RLS.
- Managers can edit requirements only for locations they manage, unless they are global admins.
- Client links should be token based. Clients do not need accounts.
- ID documents belong in a private storage bucket. Staff access should use short-lived signed URLs after RLS checks.
- Age should not be manually entered by clients. It is computed from DOB and stored as an audit snapshot.

