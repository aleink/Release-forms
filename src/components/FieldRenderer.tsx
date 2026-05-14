import type { RequirementField } from "../data/requirements";

interface FieldRendererProps {
  field: RequirementField;
  value: string | boolean | File | null | undefined;
  onChange: (value: string | boolean | File | null) => void;
}

export function FieldRenderer({ field, value, onChange }: FieldRendererProps) {
  const id = `field-${field.id}`;
  const label = (
    <span className="field-label">
      {field.label}
      {field.required && <span className="required-mark"> *</span>}
    </span>
  );

  if (field.type === "checkbox") {
    return (
      <label className="check-row" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          required={field.required}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{field.label}</span>
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <label className="field" htmlFor={id}>
        {label}
        <select id={id} value={String(value ?? "")} required={field.required} onChange={(event) => onChange(event.target.value)}>
          <option value="">Select</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
        {field.helper && <span className="field-helper">{field.helper}</span>}
      </label>
    );
  }

  if (field.type === "textarea") {
    return (
      <label className="field" htmlFor={id}>
        {label}
        <textarea
          id={id}
          value={String(value ?? "")}
          required={field.required}
          onChange={(event) => onChange(event.target.value)}
          rows={4}
        />
        {field.helper && <span className="field-helper">{field.helper}</span>}
      </label>
    );
  }

  if (field.type === "file") {
    return (
      <label className="file-field" htmlFor={id}>
        <span>
          {label}
          {field.helper && <small>{field.helper}</small>}
        </span>
        <input
          id={id}
          type="file"
          accept="image/*,.pdf"
          required={field.required}
          onChange={(event) => onChange(event.target.files?.[0] ?? null)}
        />
      </label>
    );
  }

  return (
    <label className="field" htmlFor={id}>
      {label}
      <input
        id={id}
        type={field.type === "date" ? "date" : field.type === "phone" ? "tel" : "text"}
        value={typeof value === "string" ? value : ""}
        required={field.required}
        onChange={(event) => onChange(event.target.value)}
      />
      {field.helper && <span className="field-helper">{field.helper}</span>}
    </label>
  );
}
