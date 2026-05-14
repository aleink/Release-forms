interface ProgressRailProps {
  steps: string[];
  currentStep: number;
}

export function ProgressRail({ steps, currentStep }: ProgressRailProps) {
  return (
    <div className="progress-rail" aria-label="Progress">
      {steps.map((step, index) => (
        <div className={`progress-step ${index <= currentStep ? "active" : ""}`} key={step}>
          <span>{index + 1}</span>
          <strong>{step}</strong>
        </div>
      ))}
    </div>
  );
}

