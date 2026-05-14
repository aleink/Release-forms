import { FormEvent, useMemo, useState } from "react";
import { Lock, Search, ShieldCheck } from "lucide-react";
import { requirementLocations, staffFieldsFor } from "../data/requirements";
import { signInStaff } from "../lib/supabase";
import { mockReleaseForms } from "../lib/mockData";

export function StaffDashboard() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [locationId, setLocationId] = useState("las_vegas");
  const [query, setQuery] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const currentLocation = requirementLocations.find((location) => location.id === locationId) ?? requirementLocations[0];
  const tattooStaffFields = staffFieldsFor(locationId, "tattoo");
  const piercingStaffFields = staffFieldsFor(locationId, "piercing");

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return mockReleaseForms
      .filter((row) => row.locationId === locationId)
      .filter((row) => !q || row.clientName.toLowerCase().includes(q) || row.id.toLowerCase().includes(q));
  }, [locationId, query]);

  const onLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await signInStaff(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
      setLoggedIn(true);
      setAuthError(null);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Login failed");
    }
  };

  if (!loggedIn) {
    return (
      <main className="operator-shell auth-layout">
        <form className="auth-card" onSubmit={onLogin}>
          <div className="auth-icon"><Lock size={24} /></div>
          <h1>Staff login</h1>
          <label className="field">
            <span className="field-label">Email</span>
            <input name="email" type="email" defaultValue="demo@clubtattoo.com" />
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <input name="password" type="password" defaultValue="demo-password" />
          </label>
          {authError && <div className="error-banner">{authError}</div>}
          <button className="primary-button" type="submit">Sign in</button>
        </form>
      </main>
    );
  }

  return (
    <main className="operator-shell">
      <header className="operator-header">
        <div>
          <p className="eyebrow">Staff</p>
          <h1>Release forms</h1>
        </div>
        <div className="scope-pill">
          <ShieldCheck size={16} />
          <select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
            {requirementLocations.map((location) => (
              <option key={location.id} value={location.id}>{location.name}</option>
            ))}
          </select>
        </div>
      </header>

      <section className="metric-grid">
        <div><span>Submitted</span><strong>{visibleRows.filter((row) => row.status === "submitted").length}</strong></div>
        <div><span>Needs review</span><strong>{visibleRows.filter((row) => row.status === "needs_review").length}</strong></div>
        <div><span>Cleared</span><strong>{visibleRows.filter((row) => row.status === "cleared").length}</strong></div>
      </section>

      <section className="table-panel staff-checklist-panel">
        <h2>{currentLocation.name} staff completion</h2>
        <div className="staff-checklist-grid">
          <div>
            <strong>Tattoo</strong>
            <div className="requirement-list compact-list">
              {tattooStaffFields.map((field) => <span key={field.id}>{field.label}</span>)}
            </div>
          </div>
          <div>
            <strong>Piercing</strong>
            <div className="requirement-list compact-list">
              {piercingStaffFields.map((field) => <span key={field.id}>{field.label}</span>)}
            </div>
          </div>
        </div>
      </section>

      <section className="table-panel">
        <label className="search-field">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search client or form ID" />
        </label>
        <div className="data-table">
          <div className="table-row table-head">
            <span>Form</span>
            <span>Client</span>
            <span>Service</span>
            <span>Age</span>
            <span>Status</span>
          </div>
          {visibleRows.map((row) => (
            <div className="table-row" key={row.id}>
              <span>{row.id}</span>
              <strong>{row.clientName}</strong>
              <span>{row.serviceType}</span>
              <span>{row.ageAtSubmission}</span>
              <span className={`status ${row.status}`}>{row.status.replace("_", " ")}</span>
            </div>
          ))}
          {visibleRows.length === 0 && <div className="empty-row">No forms for this location.</div>}
        </div>
      </section>
    </main>
  );
}
