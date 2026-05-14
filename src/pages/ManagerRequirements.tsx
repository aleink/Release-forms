import { useMemo, useState } from "react";
import { ClipboardList, Plus } from "lucide-react";
import { requirementLocations, type RequirementField, type ServiceType } from "../data/requirements";

export function ManagerRequirements() {
  const [locationId, setLocationId] = useState("las_vegas");
  const [serviceType, setServiceType] = useState<ServiceType>("tattoo");
  const [draftFields, setDraftFields] = useState<Record<string, RequirementField[]>>({});
  const location = requirementLocations.find((item) => item.id === locationId) ?? requirementLocations[0];
  const fieldKey = `${locationId}:${serviceType}`;
  const fields = useMemo(() => {
    if (draftFields[fieldKey]) return draftFields[fieldKey];
    return serviceType === "tattoo" ? location.tattooFields : location.piercingFields;
  }, [draftFields, fieldKey, location, serviceType]);

  const addField = () => {
    const next: RequirementField = {
      id: `custom_${fields.length + 1}`,
      label: "New requirement",
      type: "text",
      required: true,
      audience: "staff",
    };
    setDraftFields((previous) => ({ ...previous, [fieldKey]: [...fields, next] }));
  };

  return (
    <main className="operator-shell">
      <header className="operator-header">
        <div>
          <p className="eyebrow">Manager</p>
          <h1>Requirement profiles</h1>
        </div>
        <button className="primary-button" type="button" onClick={addField}>
          <Plus size={18} /> Add field
        </button>
      </header>

      <section className="requirements-layout">
        <aside className="requirements-sidebar">
          {requirementLocations.map((item) => (
            <button
              key={item.id}
              className={item.id === locationId ? "selected" : ""}
              onClick={() => setLocationId(item.id)}
              type="button"
            >
              <strong>{item.name}</strong>
              <span>{item.jurisdiction}</span>
            </button>
          ))}
        </aside>

        <section className="requirements-panel">
          <div className="panel-title">
            <ClipboardList size={20} />
            <div>
              <h2>{location.name}</h2>
              <p>{location.retentionYears}-year minimum record retention profile</p>
            </div>
          </div>
          <div className="segmented compact">
            {(["tattoo", "piercing"] as ServiceType[]).map((type) => (
              <button
                type="button"
                key={type}
                className={serviceType === type ? "selected" : ""}
                onClick={() => setServiceType(type)}
              >
                {type}
              </button>
            ))}
          </div>
          <div className="requirement-list">
            {fields.map((field) => (
              <div className="requirement-row" key={field.id}>
                <span>{field.label}</span>
                <small>{field.audience === "client" ? "client" : "staff"} / {field.type}{field.required ? " / required" : " / optional"}</small>
              </div>
            ))}
          </div>
          <div className="source-list">
            {location.sources.map((source) => (
              <a key={source.label} href={source.url} target="_blank" rel="noreferrer">
                <strong>{source.label}</strong>
                <span>{source.note}</span>
              </a>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
