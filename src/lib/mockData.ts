import type { ServiceType } from "../data/requirements";

export interface ReleaseSubmissionRow {
  id: string;
  clientName: string;
  locationId: string;
  locationName: string;
  serviceType: ServiceType;
  status: "submitted" | "needs_review" | "cleared" | "archived";
  submittedAt: string;
  ageAtSubmission: number;
}

export const mockReleaseForms: ReleaseSubmissionRow[] = [
  {
    id: "RF-24018",
    clientName: "Demo Client 001",
    locationId: "las_vegas",
    locationName: "Las Vegas",
    serviceType: "tattoo",
    status: "submitted",
    submittedAt: "2026-05-13T15:12:00.000Z",
    ageAtSubmission: 26,
  },
  {
    id: "RF-24017",
    clientName: "Demo Client 002",
    locationId: "miami",
    locationName: "Miami",
    serviceType: "piercing",
    status: "needs_review",
    submittedAt: "2026-05-13T14:05:00.000Z",
    ageAtSubmission: 17,
  },
  {
    id: "RF-24016",
    clientName: "Demo Client 003",
    locationId: "new_jersey",
    locationName: "New Jersey",
    serviceType: "tattoo",
    status: "cleared",
    submittedAt: "2026-05-12T21:48:00.000Z",
    ageAtSubmission: 31,
  },
];
