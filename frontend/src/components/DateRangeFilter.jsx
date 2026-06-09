import React, { useState } from "react";

const PRESETS = [
  { label: "Today", value: "today" },
  { label: "Last 7 days", value: "last_7d" },
  { label: "Last 30 days", value: "last_30d" },
  { label: "Last 90 days", value: "last_90d" },
];

export default function DateRangeFilter({ onApply, loading }) {
  const [activePreset, setActivePreset] = useState("last_30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  function handlePreset(value) {
    setActivePreset(value);
    setShowCustom(false);
    onApply({ range: value });
  }

  function handleCustomToggle() {
    setActivePreset(null);
    setShowCustom(true);
  }

  function handleApplyCustom() {
    if (!customFrom || !customTo) return;
    onApply({ from: customFrom, to: customTo });
  }

  return (
    <div className="card">
      <div className="card-title">Date Range</div>
      <div className="filter-bar">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            className={`filter-btn ${activePreset === p.value ? "active" : ""}`}
            onClick={() => handlePreset(p.value)}
            disabled={loading}
          >
            {p.label}
          </button>
        ))}

        <button
          className={`filter-btn ${showCustom ? "active" : ""}`}
          onClick={handleCustomToggle}
          disabled={loading}
        >
          Custom range
        </button>

        {showCustom && (
          <div className="filter-custom">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              max={customTo || undefined}
            />
            <span style={{ color: "#5e6c84" }}>to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              min={customFrom || undefined}
            />
            <button
              className="apply-btn"
              onClick={handleApplyCustom}
              disabled={!customFrom || !customTo || loading}
            >
              Apply
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
