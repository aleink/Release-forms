import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { ClipboardCheck, FileSignature, Settings } from "lucide-react";
import { ClientReleaseForm } from "./pages/ClientReleaseForm";
import { StaffDashboard } from "./pages/StaffDashboard";
import { ManagerRequirements } from "./pages/ManagerRequirements";
import { isReleaseFormDemoMode, isReleaseFormRuntimeActive } from "./lib/supabase";

function InactiveLanding() {
  return (
    <main className="inactive-shell">
      <section className="inactive-card" aria-labelledby="inactive-title">
        <p className="eyebrow">Club Tattoo release forms</p>
        <h1 id="inactive-title">This standalone form is not active.</h1>
        <p>Use only the secure release-form link sent by your studio. Contact the studio if you need a new link.</p>
        <a href="https://bookingclubtattoo.com/">Return to Club Tattoo booking</a>
      </section>
    </main>
  );
}

export function App() {
  if (!isReleaseFormRuntimeActive) return <InactiveLanding />;

  return (
    <>
      <nav className="app-nav">
        {isReleaseFormDemoMode && <NavLink to="/form/demo"><FileSignature size={17} /> Demo client form</NavLink>}
        <NavLink to="/staff"><ClipboardCheck size={17} /> Staff</NavLink>
        <NavLink to="/manager"><Settings size={17} /> Manager</NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<Navigate to={isReleaseFormDemoMode ? "/form/demo" : "/staff"} replace />} />
        <Route path="/form/:token" element={<ClientReleaseForm />} />
        <Route path="/staff" element={<StaffDashboard />} />
        <Route path="/manager" element={<ManagerRequirements />} />
      </Routes>
    </>
  );
}
