import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { ClipboardCheck, FileSignature, Settings } from "lucide-react";
import { ClientReleaseForm } from "./pages/ClientReleaseForm";
import { StaffDashboard } from "./pages/StaffDashboard";
import { ManagerRequirements } from "./pages/ManagerRequirements";

export function App() {
  return (
    <>
      <nav className="app-nav">
        <NavLink to="/form/demo"><FileSignature size={17} /> Client form</NavLink>
        <NavLink to="/staff"><ClipboardCheck size={17} /> Staff</NavLink>
        <NavLink to="/manager"><Settings size={17} /> Manager</NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<Navigate to="/form/demo" replace />} />
        <Route path="/form/:token" element={<ClientReleaseForm />} />
        <Route path="/staff" element={<StaffDashboard />} />
        <Route path="/manager" element={<ManagerRequirements />} />
      </Routes>
    </>
  );
}

