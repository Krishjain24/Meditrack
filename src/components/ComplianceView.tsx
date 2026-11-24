import { useEffect, useState } from "react";
import { Download, QrCode, Search, ShieldCheck } from "lucide-react";
import QRCode from "qrcode";
import { verifyManifestHash } from "../api/client";
import type { DashboardPayload, DisposalManifest } from "../types/meditrack";
import { filterLedger, formatUtcTime, getCategoryMeta } from "../utils/wasteLogic";

interface ComplianceViewProps {
  data: DashboardPayload;
}

const CAT_FILTERS = [
  { id: "all", label: "All Streams" },
  { id: "yellow", label: "Yellow" },
  { id: "red", label: "Red" },
  { id: "white", label: "White" },
  { id: "blue", label: "Blue" },
];

export function ComplianceView({ data }: ComplianceViewProps) {
  const [catFilter, setCatFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedManifest, setSelectedManifest] = useState<DisposalManifest | null>(
    data.disposal_ledger[0] ?? null
  );
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [verificationState, setVerificationState] = useState<{
    manifest_id: string;
    valid: boolean;
  } | null>(null);

  const filtered = filterLedger(data.disposal_ledger, catFilter, searchQuery);

  useEffect(() => {
    if (!selectedManifest && data.disposal_ledger.length > 0) {
      setSelectedManifest(data.disposal_ledger[0]);
    }
  }, [data.disposal_ledger, selectedManifest]);

  useEffect(() => {
    let active = true;
    if (!selectedManifest) {
      setQrDataUrl("");
      return;
    }
    QRCode.toDataURL(selectedManifest.qr_payload, {
      width: 180,
      margin: 1,
      color: { dark: "#0f172a", light: "#ffffff" },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl("");
      });
    return () => {
      active = false;
    };
  }, [selectedManifest]);

  async function handleVerify(manifestId: string) {
    try {
      const res = await verifyManifestHash(manifestId);
      setVerificationState({ manifest_id: res.manifest_id, valid: res.valid });
    } catch {
      setVerificationState({ manifest_id: manifestId, valid: false });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            QR Chain-of-Custody &amp; Automated Disposal Reporting
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Tamper-evident disposal records with SHA-256 chain hashes and CPCB Biomedical Waste
            Rules 2016 CSV compliance export.
          </p>
        </div>

        <a
          href="/api/py/reports/csv"
          download="meditrack_cpcb_disposal_report.csv"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Download className="w-4 h-4" aria-hidden="true" />
          <span>Export CPCB Report (CSV)</span>
        </a>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {CAT_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setCatFilter(f.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                catFilter === f.id
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="relative w-full lg:w-72">
          <label htmlFor="ledger-search" className="sr-only">
            Search disposal manifests
          </label>
          <Search
            className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
            aria-hidden="true"
          />
          <input
            id="ledger-search"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search manifest ID, bin, facility..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Ledger Table */}
        <section className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
          {filtered.length === 0 ? (
            <div className="py-12 px-4 text-center">
              <p className="text-sm font-medium text-slate-900">
                No disposal manifests match your search
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                    <th className="py-3 px-4">Manifest ID</th>
                    <th className="py-3 px-3">Facility &amp; Bin</th>
                    <th className="py-3 px-3">Stream</th>
                    <th className="py-3 px-3 text-right">Weight</th>
                    <th className="py-3 px-3">Treatment</th>
                    <th className="py-3 px-4 text-right">Disposed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filtered.map((item) => {
                    const cat = getCategoryMeta(item.category);
                    const isSelected = selectedManifest?.manifest_id === item.manifest_id;
                    return (
                      <tr
                        key={item.manifest_id}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? "bg-blue-50/60" : "hover:bg-slate-50"
                        }`}
                        onClick={() => {
                          setSelectedManifest(item);
                          setVerificationState(null);
                        }}
                      >
                        <td className="py-3 px-4 font-mono font-semibold text-blue-700 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedManifest(item);
                              setVerificationState(null);
                            }}
                            className="hover:underline text-left"
                          >
                            {item.manifest_id}
                          </button>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-medium text-slate-900">{item.facility_name}</div>
                          <div className="font-mono text-slate-500">
                            {item.bin_code} · {item.vehicle_code}
                          </div>
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 font-medium text-slate-800">
                            <span
                              className={`w-2.5 h-2.5 rounded-sm ${cat.swatchClass}`}
                              aria-hidden="true"
                            />
                            <span>{cat.shortLabel}</span>
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                          {item.weight_kg.toFixed(2)} kg
                        </td>
                        <td className="py-3 px-3 text-slate-700">{item.treatment_method}</td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-500 whitespace-nowrap">
                          {formatUtcTime(item.disposal_time)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* QR Inspector */}
        <section className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">QR Manifest Inspector</h2>
            <QrCode className="w-4 h-4 text-slate-400" aria-hidden="true" />
          </div>

          {!selectedManifest ? (
            <p className="text-xs text-slate-500 py-8 text-center">
              Select a manifest row to inspect its scannable QR chain-of-custody record.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col items-center p-4 bg-slate-50 border border-slate-200 rounded-xl">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt={`QR code for ${selectedManifest.manifest_id}`}
                    className="w-40 h-40 rounded"
                  />
                ) : (
                  <div className="w-40 h-40 bg-slate-200 rounded flex items-center justify-center text-xs text-slate-500">
                    Generating QR...
                  </div>
                )}
                <p className="mt-2 font-mono text-xs font-bold text-slate-900">
                  {selectedManifest.manifest_id}
                </p>
              </div>

              <dl className="space-y-2 text-xs">
                <div className="flex justify-between gap-2 py-1 border-b border-slate-100">
                  <dt className="text-slate-500">Facility</dt>
                  <dd className="font-medium text-slate-900 text-right">
                    {selectedManifest.facility_name}
                  </dd>
                </div>
                <div className="flex justify-between gap-2 py-1 border-b border-slate-100">
                  <dt className="text-slate-500">Bin &amp; Vehicle</dt>
                  <dd className="font-mono text-slate-900">
                    {selectedManifest.bin_code} · {selectedManifest.vehicle_code}
                  </dd>
                </div>
                <div className="flex justify-between gap-2 py-1 border-b border-slate-100">
                  <dt className="text-slate-500">Mass Treated</dt>
                  <dd className="font-mono tabular-nums font-semibold text-slate-900">
                    {selectedManifest.weight_kg.toFixed(2)} kg
                  </dd>
                </div>
                <div className="flex justify-between gap-2 py-1 border-b border-slate-100">
                  <dt className="text-slate-500">SHA-256 Hash</dt>
                  <dd className="font-mono text-slate-800">{selectedManifest.chain_hash}</dd>
                </div>
              </dl>

              <button
                type="button"
                onClick={() => handleVerify(selectedManifest.manifest_id)}
                className="w-full inline-flex items-center justify-center gap-2 py-2 px-4 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors"
              >
                <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                <span>Verify Chain Integrity</span>
              </button>

              {verificationState &&
                verificationState.manifest_id === selectedManifest.manifest_id && (
                  <p
                    className={`text-xs font-medium text-center ${
                      verificationState.valid ? "text-emerald-700" : "text-rose-700"
                    }`}
                  >
                    {verificationState.valid
                      ? "● Chain hash verified against Python SQLite ledger."
                      : "✖ Hash mismatch detected."}
                  </p>
                )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
