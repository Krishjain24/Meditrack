import { useState, type ChangeEvent, type FormEvent } from "react";
import { Lock, ShieldCheck, Sparkles, Unlock, Upload } from "lucide-react";
import { classifyImageWithGemini, segregateWaste } from "../api/client";
import type {
  ClassificationResult,
  DashboardPayload,
  SmartBin,
  WasteCategoryKey,
} from "../types/meditrack";
import {
  CLINICAL_SPECIMENS,
  formatUtcTime,
  getCategoryMeta,
} from "../utils/wasteLogic";

interface SegregationViewProps {
  data: DashboardPayload;
  onDataUpdated: (dashboard: DashboardPayload) => void;
}

export function SegregationView({ data, onDataUpdated }: SegregationViewProps) {
  const [facilityName, setFacilityName] = useState<string>(
    data.facilities[0]?.name || "AIIMS Trauma & Ward A"
  );
  const [itemName, setItemName] = useState<string>(CLINICAL_SPECIMENS[0].item_name);
  const [description, setDescription] = useState<string>(CLINICAL_SPECIMENS[0].description);
  const [weightG, setWeightG] = useState<string>(String(CLINICAL_SPECIMENS[0].weight_g));
  const [imagePreview, setImagePreview] = useState<string>("");
  const [imageMime, setImageMime] = useState<string>("image/jpeg");
  const [hintCategory, setHintCategory] = useState<WasteCategoryKey | "">("");

  const [submitting, setSubmitting] = useState(false);
  const [aiInspecting, setAiInspecting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [lastResult, setLastResult] = useState<{
    classification: ClassificationResult;
    bin: SmartBin;
    alertTriggered: boolean;
  } | null>(null);

  const facilityBins = data.bins.filter((b) => b.facility_name === facilityName);

  function handleSelectSpecimen(specId: string) {
    const spec = CLINICAL_SPECIMENS.find((s) => s.id === specId);
    if (!spec) return;
    setItemName(spec.item_name);
    setDescription(spec.description);
    setWeightG(String(spec.weight_g));
    setHintCategory("");
    setErrorMsg("");
  }

  function handleImageUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageMime(file.type || "image/jpeg");
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setImagePreview(reader.result);
        setErrorMsg("");
      }
    };
    reader.readAsDataURL(file);
  }

  async function handleGeminiInspect() {
    if (!imagePreview) {
      setErrorMsg("Upload a waste specimen photo first to inspect with Gemini Vision.");
      return;
    }
    setAiInspecting(true);
    setErrorMsg("");
    try {
      const res = await classifyImageWithGemini({
        image_base64: imagePreview,
        mime_type: imageMime,
        notes: description || itemName,
      });
      setItemName(res.item_name || itemName);
      setDescription(res.reasoning || description);
      setHintCategory(res.category);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gemini Vision inspection unavailable."
      );
    } finally {
      setAiInspecting(false);
    }
  }

  async function handleSegregateSubmit(e: FormEvent) {
    e.preventDefault();
    if (!itemName.trim() && !imagePreview) {
      setErrorMsg("Enter a biomedical waste item name or upload an image.");
      return;
    }
    const parsedWeight = Number(weightG);
    if (!Number.isFinite(parsedWeight) || parsedWeight <= 0) {
      setErrorMsg("Weight must be a positive number in grams.");
      return;
    }

    setSubmitting(true);
    setErrorMsg("");
    try {
      const res = await segregateWaste({
        item_name: itemName.trim(),
        description: description.trim(),
        facility_name: facilityName,
        weight_g: parsedWeight,
        image_base64: imagePreview || undefined,
        hint_category: hintCategory || undefined,
      });
      setLastResult({
        classification: res.classification,
        bin: res.bin,
        alertTriggered: Boolean(res.alert_triggered),
      });
      onDataUpdated(res.dashboard);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Segregation failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Smart Identification &amp; Automated Segregation
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Python classification engine directs waste to the matching color-coded bin and locks
            non-target chambers to prevent cross-contamination.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Input & Specimen Classifier */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Specimen &amp; Camera Input
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Select a clinical sample, enter item details, or upload an image frame
            </p>
          </div>

          <div className="space-y-2">
            <span className="block text-xs font-medium text-slate-700">
              Quick Clinical Specimens
            </span>
            <div className="grid grid-cols-2 gap-2">
              {CLINICAL_SPECIMENS.map((spec) => (
                <button
                  key={spec.id}
                  type="button"
                  onClick={() => handleSelectSpecimen(spec.id)}
                  className={`text-left px-3 py-2 text-xs rounded-lg border transition-colors truncate ${
                    itemName === spec.item_name
                      ? "bg-blue-50 border-blue-300 text-blue-900 font-medium"
                      : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {spec.item_name}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleSegregateSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="seg-facility"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Healthcare Facility
              </label>
              <select
                id="seg-facility"
                value={facilityName}
                onChange={(e) => setFacilityName(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {data.facilities.map((fac) => (
                  <option key={fac.code} value={fac.name}>
                    {fac.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="seg-item-name"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Waste Item Name
              </label>
              <input
                id="seg-item-name"
                type="text"
                value={itemName}
                onChange={(e) => {
                  setItemName(e.target.value);
                  setHintCategory("");
                }}
                placeholder="e.g., Blood-soaked gauze, 22G needle, IV tubing"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label
                  htmlFor="seg-desc"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Material / Contamination Notes
                </label>
                <input
                  id="seg-desc"
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Material composition or biohazard notes"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div>
                <label
                  htmlFor="seg-weight"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Weight (grams)
                </label>
                <input
                  id="seg-weight"
                  type="number"
                  min="1"
                  max="10000"
                  value={weightG}
                  onChange={(e) => setWeightG(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="seg-image"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Camera Frame / Photo Upload (Optional)
              </label>
              <div className="flex items-center gap-3">
                <label
                  htmlFor="seg-image"
                  className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Choose Image</span>
                </label>
                <input
                  id="seg-image"
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="sr-only"
                />
                {imagePreview ? (
                  <button
                    type="button"
                    onClick={handleGeminiInspect}
                    disabled={aiInspecting}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg whitespace-nowrap shrink-0 disabled:opacity-60"
                  >
                    <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{aiInspecting ? "Inspecting..." : "Gemini Vision Inspect"}</span>
                  </button>
                ) : (
                  <span className="text-xs text-slate-500">
                    No frame uploaded; Python feature engine active
                  </span>
                )}
              </div>
              {imagePreview && (
                <div className="mt-3 flex items-center gap-3">
                  <img
                    src={imagePreview}
                    alt="Uploaded biomedical waste specimen"
                    referrerPolicy="no-referrer"
                    className="w-20 h-16 object-cover rounded-lg border border-slate-200"
                  />
                  <button
                    type="button"
                    onClick={() => setImagePreview("")}
                    className="text-xs text-rose-700 hover:underline"
                  >
                    Remove image
                  </button>
                </div>
              )}
            </div>

            {errorMsg && (
              <div
                role="alert"
                className="p-3 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg"
              >
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors disabled:opacity-60"
            >
              {submitting ? "Classifying & Actuating Bin..." : "Classify & Segregate"}
            </button>
          </form>
        </section>

        {/* Right: Actuation Result & Facility Chambers */}
        <div className="lg:col-span-7 space-y-6">
          <section className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className="text-base font-semibold text-slate-900">
              Classification &amp; Bin Lid Actuation
            </h2>

            {!lastResult ? (
              <div className="mt-4 py-8 px-4 text-center border border-dashed border-slate-200 rounded-lg">
                <ShieldCheck className="w-7 h-7 text-slate-400 mx-auto" aria-hidden="true" />
                <p className="mt-2 text-sm font-medium text-slate-800">
                  Ready for automated waste classification
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Submit an item on the left to compute CPCB category, actuate bin locks, and
                  update SQLite telemetry.
                </p>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {(() => {
                  const meta = getCategoryMeta(lastResult.classification.category);
                  return (
                    <div
                      className={`p-4 rounded-xl border ${meta.surfaceClass} ${meta.borderClass}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`w-4 h-4 rounded-sm ${meta.swatchClass}`}
                            aria-hidden="true"
                          />
                          <span className={`text-base font-bold ${meta.textClass}`}>
                            {meta.shortLabel} Chamber &mdash; {lastResult.classification.category_label}
                          </span>
                        </div>
                        <span className="text-xs font-mono tabular-nums font-semibold text-slate-700">
                          Confidence {(lastResult.classification.confidence * 100).toFixed(0)}%
                        </span>
                      </div>

                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                        <div>
                          <span className="text-slate-500 block">Target Smart Bin</span>
                          <span className="font-mono font-semibold text-slate-900">
                            {lastResult.bin.bin_code} ({lastResult.bin.fill_level.toFixed(1)}%)
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Lid Actuation</span>
                          <span className="font-medium text-slate-900">
                            {lastResult.classification.lid_actuated}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Authorized Treatment</span>
                          <span className="font-medium text-slate-900">
                            {lastResult.classification.treatment_method}
                          </span>
                        </div>
                      </div>

                      <p className="mt-3 text-xs text-slate-600">
                        {lastResult.classification.reasoning} · {lastResult.classification.method}
                      </p>

                      {lastResult.alertTriggered && (
                        <p className="mt-2 text-xs font-semibold text-rose-700">
                          ■ Overflow threshold (&ge;80%) crossed — automated collection alert
                          dispatched to Route Optimizer.
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Live Facility Bin Chambers */}
            <div className="mt-6">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                {facilityName} — Active Bin Chambers
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {facilityBins.map((bin) => {
                  const meta = getCategoryMeta(bin.category);
                  const isTarget = lastResult?.bin.bin_code === bin.bin_code;
                  return (
                    <div
                      key={bin.bin_code}
                      className={`p-3.5 rounded-lg border ${
                        isTarget
                          ? "border-blue-500 bg-blue-50/40"
                          : "border-slate-200 bg-slate-50/60"
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono font-semibold text-slate-900">
                          {bin.bin_code}
                        </span>
                        <span className="inline-flex items-center gap-1 text-slate-600">
                          {bin.lid_locked ? (
                            <>
                              <Lock className="w-3 h-3 text-rose-600" aria-hidden="true" />
                              <span>Locked</span>
                            </>
                          ) : (
                            <>
                              <Unlock className="w-3 h-3 text-emerald-600" aria-hidden="true" />
                              <span>Ready</span>
                            </>
                          )}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-700">
                        <span className={`w-2.5 h-2.5 rounded-sm ${meta.swatchClass}`} aria-hidden="true" />
                        <span>{meta.shortLabel}</span>
                        <span aria-hidden="true">·</span>
                        <span className="truncate">{bin.ward}</span>
                      </div>
                      <div className="mt-3 flex items-baseline justify-between text-xs font-mono tabular-nums">
                        <span className="font-bold text-slate-900">
                          {bin.fill_level.toFixed(1)}%
                        </span>
                        <span className="text-slate-500">{bin.weight_kg.toFixed(2)} kg</span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${meta.barClass}`}
                          style={{ width: `${Math.min(100, bin.fill_level)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Recent Segregation Log */}
          <section className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className="text-base font-semibold text-slate-900 mb-4">
              Recent Segregation Events
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                    <th className="py-2 pr-3">Item</th>
                    <th className="py-2 px-3">Category</th>
                    <th className="py-2 px-3">Bin</th>
                    <th className="py-2 px-3 text-right">Mass</th>
                    <th className="py-2 pl-3 text-right">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {data.segregation_events.slice(0, 8).map((ev) => {
                    const meta = getCategoryMeta(ev.detected_category);
                    return (
                      <tr key={ev.id} className="hover:bg-slate-50">
                        <td className="py-2.5 pr-3">
                          <div className="font-medium text-slate-900">{ev.item_name}</div>
                          <div className="text-slate-500">{ev.facility_name}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="inline-flex items-center gap-1.5 font-medium text-slate-800">
                            <span className={`w-2.5 h-2.5 rounded-sm ${meta.swatchClass}`} aria-hidden="true" />
                            <span>{meta.shortLabel}</span>
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-700">{ev.bin_code}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900">
                          {ev.weight_g.toFixed(0)} g
                        </td>
                        <td className="py-2.5 pl-3 text-right font-mono tabular-nums text-slate-500">
                          {formatUtcTime(ev.timestamp)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
