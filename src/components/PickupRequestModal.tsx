import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { createPickupRequest } from "../api/client";
import type {
  DashboardPayload,
  FacilityNode,
  WasteCategoryKey,
} from "../types/meditrack";

interface PickupRequestModalProps {
  isOpen: boolean;
  facilities: FacilityNode[];
  onClose: () => void;
  onCreated: (dashboard: DashboardPayload) => void;
}

export function PickupRequestModal({
  isOpen,
  facilities,
  onClose,
  onCreated,
}: PickupRequestModalProps) {
  const [facilityName, setFacilityName] = useState<string>(
    facilities[0]?.name || "AIIMS Bhopal"
  );
  const [category, setCategory] = useState<WasteCategoryKey>("yellow");
  const [priority, setPriority] = useState<"critical" | "high" | "normal">("high");
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");

  if (!isOpen) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!notes.trim()) {
      setErrorMsg("Please enter ward or pickup notes before submitting.");
      return;
    }
    setSubmitting(true);
    setErrorMsg("");
    try {
      const res = await createPickupRequest({
        facility_name: facilityName,
        category,
        priority,
        notes: notes.trim(),
      });
      onCreated(res.dashboard);
      setNotes("");
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Unable to submit pickup request."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pickup-modal-title"
    >
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-5 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 id="pickup-modal-title" className="text-lg font-bold text-slate-900">
            Request Waste Collection Pickup
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close pickup request dialog"
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="pickup-facility"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Healthcare Facility
            </label>
            <select
              id="pickup-facility"
              value={facilityName}
              onChange={(e) => setFacilityName(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
            >
              {facilities.map((f) => (
                <option key={f.code} value={f.name}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="pickup-category"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Waste Category
              </label>
              <select
                id="pickup-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as WasteCategoryKey)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
              >
                <option value="yellow">Yellow (Infectious)</option>
                <option value="red">Red (Recyclable Plastics)</option>
                <option value="white">White (Sharps)</option>
                <option value="blue">Blue (Glassware)</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="pickup-priority"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Urgency
              </label>
              <select
                id="pickup-priority"
                value={priority}
                onChange={(e) =>
                  setPriority(e.target.value as "critical" | "high" | "normal")
                }
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
              >
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="normal">Normal</option>
              </select>
            </div>
          </div>

          <div>
            <label
              htmlFor="pickup-notes"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Ward &amp; Dispatch Notes
            </label>
            <textarea
              id="pickup-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g., OT-2 surgical shift completed, sealed biohazard bags ready at Bay B"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="p-3 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg"
            >
              {errorMsg}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg disabled:opacity-60"
            >
              {submitting ? "Submitting..." : "Submit Pickup Request"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
