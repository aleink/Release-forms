export type ServiceType = "tattoo" | "piercing";
export type FieldType =
  | "text"
  | "textarea"
  | "phone"
  | "date"
  | "select"
  | "checkbox"
  | "file"
  | "signature";

export interface RequirementField {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  audience?: "client" | "staff";
  appliesTo?: ServiceType[];
  helper?: string;
  options?: string[];
  source?: string;
}

export interface RequirementSource {
  label: string;
  url?: string;
  note: string;
}

export interface LocationRequirement {
  id: string;
  name: string;
  shortName: string;
  state: string;
  jurisdiction: string;
  timezone: string;
  adultAge: number;
  retentionYears: number;
  tattooFields: RequirementField[];
  piercingFields: RequirementField[];
  minorRules: string[];
  sources: RequirementSource[];
}

export const standardHealthFields: RequirementField[] = [
  {
    id: "not_intoxicated",
    label: "I am not under the influence of alcohol or drugs.",
    type: "checkbox",
    required: true,
  },
  {
    id: "not_pregnant_or_nursing",
    label: "I am not pregnant or nursing.",
    type: "checkbox",
    required: true,
  },
  {
    id: "nsaids_last_24h",
    label: "Have you taken NSAIDS, antiplatelet, or anticoagulant drugs in the last 24 hours?",
    type: "select",
    required: true,
    options: ["No", "Yes"],
  },
  {
    id: "eaten_last_4h",
    label: "Have you eaten in the past 4 hours?",
    type: "select",
    required: true,
    options: ["Yes", "No"],
  },
  {
    id: "health_conditions",
    label: "Health conditions that apply",
    type: "textarea",
    required: false,
    helper: "Examples: diabetes, anemia, hemophilia, hypoglycemia, dialysis, latex or lidocaine allergy, skin sensitivity, seizures, HIV, hepatitis, jaundice, prone to fainting, or none.",
  },
  {
    id: "skin_disease_history",
    label: "Do you have a history of skin disease that might inhibit healing?",
    type: "select",
    required: true,
    options: ["No", "Yes"],
  },
];

export const standardDocuments: RequirementField[] = [
  {
    id: "client_government_id",
    label: "Government-issued photo ID",
    type: "file",
    required: true,
    helper: "Photo or PDF.",
  },
  {
    id: "guardian_government_id",
    label: "Parent or legal guardian government-issued photo ID",
    type: "file",
    required: false,
    helper: "Only required for minors.",
  },
  {
    id: "minor_birth_certificate_or_guardianship",
    label: "Birth certificate, court order, or proof of guardianship",
    type: "file",
    required: false,
    helper: "Only required for minors.",
  },
];

const emergencyContactField: RequirementField = {
  id: "emergency_contact",
  label: "Emergency contact name and phone number",
  type: "text",
  required: true,
  audience: "client",
};

export const requirementLocations: LocationRequirement[] = [
  {
    id: "miami",
    name: "Miami",
    shortName: "Miami",
    state: "FL",
    jurisdiction: "Florida Department of Health / Miami-Dade",
    timezone: "America/New_York",
    adultAge: 18,
    retentionYears: 2,
    tattooFields: [
      { id: "race", label: "Race", type: "text", required: true, audience: "client", source: "Florida body piercing customer record model" },
      { id: "artist_name", label: "Artist name", type: "text", required: true, audience: "staff" },
      { id: "artist_signature", label: "Artist signature", type: "signature", required: true, audience: "staff" },
    ],
    piercingFields: [
      { id: "emergency_contact_name", label: "Emergency contact name", type: "text", required: true, audience: "client" },
      { id: "emergency_contact_phone", label: "Emergency contact phone number", type: "phone", required: true, audience: "client" },
      { id: "emergency_contact_address", label: "Emergency contact address", type: "text", required: true, audience: "client" },
      { id: "physician_name", label: "Physician's name", type: "text", required: true, audience: "client" },
      { id: "physician_phone", label: "Physician's phone number", type: "phone", required: true, audience: "client" },
      { id: "physician_address", label: "Physician's address", type: "text", required: true, audience: "client" },
      { id: "race", label: "Race", type: "text", required: true, audience: "client" },
      { id: "piercer_name", label: "Piercer name", type: "text", required: true, audience: "staff" },
      { id: "piercer_signature", label: "Piercer signature", type: "signature", required: true, audience: "staff" },
      { id: "piercing_type", label: "Piercing type", type: "text", required: true, audience: "staff" },
      { id: "jewelry_type_used", label: "Jewelry type used", type: "text", required: true, audience: "staff" },
    ],
    minorRules: [
      "Tattooing of a minor in Florida uses the state notarized consent form for ages 16 through 17.",
      "Body piercing of a minor requires written notarized parent or legal guardian consent. A minor under 16 must also be accompanied by the parent or legal guardian.",
    ],
    sources: [
      {
        label: "Florida tattoo minor consent",
        url: "https://www.floridahealth.gov/environmental-health/tattooing/_documents/Notarized_Minor_Consent.pdf",
        note: "State form DH 4146 for tattooing of a minor child age 16 through 17.",
      },
      {
        label: "Florida body piercing customer record",
        url: "https://www.floridahealth.gov/environmental-health/body-piercing/_documents/customer.pdf",
        note: "Customer record model includes DOB, race, sex, physician, emergency contact, allergies, bleeding history, piercing location, jewelry, and piercer signature.",
      },
      {
        label: "Florida body piercing minor consent",
        url: "https://www.floridahealth.gov/environmental-health/body-piercing/consent.pdf",
        note: "Notarized parent or guardian consent language for piercing of a minor.",
      },
    ],
  },
  {
    id: "houston",
    name: "Houston",
    shortName: "Houston",
    state: "TX",
    jurisdiction: "Texas Department of State Health Services",
    timezone: "America/Chicago",
    adultAge: 18,
    retentionYears: 2,
    tattooFields: [
      { id: "ink_colors", label: "Ink color(s) used", type: "text", required: true, audience: "staff" },
      { id: "ink_lot_numbers", label: "Lot number(s) for ink used", type: "text", required: true, audience: "staff" },
      { id: "body_location", label: "Location on body", type: "text", required: true, audience: "staff" },
      { id: "artist_name", label: "Artist name", type: "text", required: true, audience: "staff" },
    ],
    piercingFields: [
      { id: "piercing_type", label: "Piercing type", type: "text", required: true, audience: "staff" },
      { id: "jewelry_type_used", label: "Jewelry type used", type: "text", required: true, audience: "staff" },
      { id: "piercer_name", label: "Piercer name", type: "text", required: true, audience: "staff" },
    ],
    minorRules: [
      "Texas tattooing of a minor is limited to specific existing-tattoo coverage conditions under Texas rules.",
      "Texas piercing of a minor requires parent, managing conservator, or guardian consent through notarized consent or in-person statements with valid identification.",
    ],
    sources: [
      {
        label: "Texas DSHS tattoo and body piercing licensing requirements",
        url: "https://www.dshs.texas.gov/tattoo-body-piercing-studios/licensing-requirements-tattoo-body-piercing-studios",
        note: "State guidance for minor consent, adult presence, identification, aftercare instructions, and recordkeeping.",
      },
    ],
  },
  {
    id: "las_vegas",
    name: "Las Vegas",
    shortName: "LV",
    state: "NV",
    jurisdiction: "Southern Nevada Health District",
    timezone: "America/Los_Angeles",
    adultAge: 18,
    retentionYears: 2,
    tattooFields: [
      { id: "ink_colors", label: "Ink color(s) used", type: "text", required: true, audience: "staff" },
      { id: "ink_lot_numbers", label: "Lot number(s) for ink used", type: "text", required: true, audience: "staff" },
      { id: "ink_expiration_dates", label: "Expiration date(s) of ink used", type: "text", required: true, audience: "staff" },
      { id: "needle_expiration_dates", label: "Expiration date(s) of needles used", type: "text", required: true, audience: "staff" },
      { id: "needle_lot_numbers", label: "Lot number(s) of needles used", type: "text", required: true, audience: "staff" },
      { id: "body_location", label: "Location on body", type: "text", required: true, audience: "staff" },
      { id: "artist_name", label: "Artist name", type: "text", required: true, audience: "staff" },
      { id: "artist_signature", label: "Artist signature", type: "signature", required: true, audience: "staff" },
      { id: "design_description", label: "Design", type: "textarea", required: true, audience: "staff" },
    ],
    piercingFields: [
      { id: "piercing_type", label: "Piercing type", type: "text", required: true, audience: "staff" },
      { id: "jewelry_type_used", label: "Jewelry type used", type: "text", required: true, audience: "staff" },
      { id: "piercer_name", label: "Piercer name", type: "text", required: true, audience: "staff" },
      { id: "piercer_signature", label: "Piercer signature", type: "signature", required: true, audience: "staff" },
    ],
    minorRules: [
      "Southern Nevada body art rules require written consent and proper identification of a parent or guardian for minors.",
      "A procedure on a minor must be performed in the presence of the parent or guardian unless a valid emancipation exception applies.",
    ],
    sources: [
      {
        label: "Southern Nevada Health District tattoo patron records",
        url: "https://www.southernnevadahealthdistrict.org/permits-and-regulations/body-art/regulations/southern-nevada-health-district-regulations-governing-the-sanitation-and-safety-of-tattoo-establishments/section-7-patrons/",
        note: "Patron records include age, address, procedure date, operator, body location, and design description.",
      },
      {
        label: "Southern Nevada body piercing regulations",
        url: "https://media.southernnevadahealthdistrict.org/download/body-art/20190710-body-piercing-regs.pdf",
        note: "Piercing rules include minor consent, age verification, ID photocopies for patrons 21 or younger, and written aftercare instructions.",
      },
    ],
  },
  {
    id: "new_jersey",
    name: "New Jersey",
    shortName: "NJ",
    state: "NJ",
    jurisdiction: "New Jersey Department of Health",
    timezone: "America/New_York",
    adultAge: 18,
    retentionYears: 3,
    tattooFields: [
      { id: "body_location", label: "Location on body", type: "text", required: true, audience: "staff" },
      { id: "artist_name", label: "Artist name", type: "text", required: true, audience: "staff" },
      emergencyContactField,
    ],
    piercingFields: [
      { id: "piercing_type", label: "Piercing type", type: "text", required: true, audience: "staff" },
      { id: "piercer_name", label: "Piercer name", type: "text", required: true, audience: "staff" },
      emergencyContactField,
    ],
    minorRules: [
      "New Jersey body art procedures on a person under 18 require written parent or legal guardian consent.",
      "The parent or legal guardian must accompany the client, and identification for both client and parent or guardian is maintained with the application.",
    ],
    sources: [
      {
        label: "N.J.A.C. 8:27-4.2 client records",
        url: "https://www.nj.gov/health/ceohs/documents/phfpp/NJAC_8_27-4.pdf",
        note: "Client records include proof of age, emergency contact, procedure type/location, practitioner, medical history, consent, aftercare, and 3-year retention.",
      },
    ],
  },
];

export const companyReleaseText = [
  "I certify under penalty of perjury that all information provided is correct and true to the best of my knowledge.",
  "I understand the tattoo artist and/or piercer is a contracted service provider. I release Tattoo Partners Operations, LLC, doing business as Club Tattoo or Inked, from liability for claims arising from the service provider's work except where prohibited by law.",
  "I agree to follow the aftercare instructions provided to me and understand that failure to follow aftercare may result in infection, irritation, loss of pigment, scarring, or other complications.",
  "I understand a tattoo is permanent, may require surgical removal, and may lead to scarring. I approve the final design, spelling, sizing, placement, colors, and other personal design choices before the procedure begins.",
  "I acknowledge that electronic signatures on this release form are intended to be the legal equivalent of manual signatures.",
];

export function fieldsFor(locationId: string, serviceType: ServiceType): RequirementField[] {
  const location = requirementLocations.find((item) => item.id === locationId) ?? requirementLocations[0];
  return serviceType === "tattoo" ? location.tattooFields : location.piercingFields;
}

export function clientFieldsFor(locationId: string, serviceType: ServiceType): RequirementField[] {
  return fieldsFor(locationId, serviceType).filter((field) => field.audience === "client");
}

export function staffFieldsFor(locationId: string, serviceType: ServiceType): RequirementField[] {
  return fieldsFor(locationId, serviceType).filter((field) => field.audience !== "client");
}
