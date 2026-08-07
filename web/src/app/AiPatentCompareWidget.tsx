"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type PatentResult = {
  id: string;
  display_order: number;
  application_number: string;
  invention_title: string | null;
  applicant_name: string | null;
  ipc_number: string | null;
};

type JobReport = {
  id: string;
  query_text: string;
  results?: PatentResult[];
};

type ComparisonItem = {
  patent_id: string;
  title: string;
  applicant: string;
  core_technology: string;
  distinguishing_point: string;
  group_similarity_score: number;
};

type ClaimComparisonItem = {
  patent_id: string;
  source_basis: string;
  independent_claim_focus: string;
  key_elements: string[];
  differences_vs_others: string;
};

type SimilarPair = {
  left_patent_id: string;
  right_patent_id: string;
  similarity_score: number;
  reason: string;
};

type AiComparison = {
  overall_summary: string;
  common_technologies: string[];
  key_differences: string[];
  items: ComparisonItem[];
  claim_comparison: ClaimComparisonItem[];
  similar_pairs: SimilarPair[];
  novelty_inventive_step_notes: string[];
  review_notes: string[];
  limitations: string;
};

type CompareResponse = {
  model: string;
  compared_count: number;
  pdf_claim_count: number;
  analysis_basis: string;
  comparison: AiComparison;
  error?: string;
};

function shortId(value: string): string {
  return value.slice(0, 8);
}

function safeFilename(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 50);
  return cleaned || "patent_compare";
}

export default function AiPatentCompareWidget() {
  const pathname = usePathname();
  const reportMatch = pathname.match(/^\/reports\/([^/]+)\/?$/);
  const jobId = reportMatch ? decodeURIComponent(reportMatch[1]) : "";

  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [job, setJob] = useState<JobReport | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CompareResponse | null>(null);

  useEffect(() => {
    setOpen(false);
    setJob(null);
    setSelectedIds([]);
    setResult(null);
    setError("");
    if (!jobId) {
      setToken("");
      return;
    }
    const queryToken = new URLSearchParams(window.location.search).get("token") || "";
    setToken(queryToken);
  }, [jobId]);

  useEffect(() => {
    if (!open || !jobId || !token || job) return;

    let cancelled = false;
    async function loadJob() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/jobs/${encodeURIComponent(jobId)}?token=${encodeURIComponent(token)}&includeResults=1`,
          { cache: "no-store" },
        );
        const data = (await response.json()) as JobReport & { error?: string };
        if (!response.ok) {
          throw new Error(data.error || "특허 결과를 불러오지 못했습니다.");
        }
        if (!cancelled) setJob(data);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "특허 결과를 불러오지 못했습니다.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadJob();
    return () => {
      cancelled = true;
    };
  }, [open, jobId, token, job]);

  const patents = job?.results ?? [];
  const selectedPatents = useMemo(
    () => patents.filter((patent) => selectedIds.includes(patent.id)),
    [patents, selectedIds],
  );

  function togglePatent(patentId: string) {
    setResult(null);
    setError("");
    setSelectedIds((current) => {
      if (current.includes(patentId)) {
        return current.filter((id) => id !== patentId);
      }
      if (current.length >= 10) {
        setError("AI 비교는 최대 10건까지 선택할 수 있습니다.");
        return current;
      }
      return [...current, patentId];
    });
  }

  async function compareSelected() {
    if (selectedIds.length < 2 || selectedIds.length > 10) {
      setError("비교할 특허를 2~10건 선택해 주세요.");
      return;
    }
    setComparing(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch(
        `/api/jobs/${encodeURIComponent(jobId)}/ai-compare`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, patentIds: selectedIds }),
        },
      );
      const data = (await response.json()) as CompareResponse;
      if (!response.ok) {
        throw new Error(data.error || "GPT-5 mini 비교 요청에 실패했습니다.");
      }
      setResult(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "GPT-5 mini 비교 요청에 실패했습니다.");
    } finally {
      setComparing(false);
    }
  }

  function printComparison() {
    if (!result) return;
    const previousTitle = document.title;
    const query = safeFilename(job?.query_text || "patent_compare");
    document.title = `KIPRIS_AI_특허비교_${query}`;
    window.addEventListener(
      "afterprint",
      () => {
        document.title = previousTitle;
      },
      { once: true },
    );
    window.print();
  }

  if (!jobId) return null;

  return (
    <>
      <style>{`
        @media print {
          html, body {
            background: #ffffff !important;
          }
          body * {
            visibility: hidden !important;
          }
          .ai-compare-overlay {
            position: static !important;
            inset: auto !important;
            display: block !important;
            background: #ffffff !important;
            padding: 0 !important;
          }
          .ai-compare-modal {
            width: 100% !important;
            max-height: none !important;
            overflow: visible !important;
            border-radius: 0 !important;
            padding: 0 !important;
            box-shadow: none !important;
          }
          #ai-compare-print-area,
          #ai-compare-print-area * {
            visibility: visible !important;
          }
          #ai-compare-print-area {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            border-top: 0 !important;
          }
          #ai-compare-print-area table {
            font-size: 10px !important;
          }
          #ai-compare-print-area section,
          #ai-compare-print-area tr,
          #ai-compare-print-area .print-avoid-break {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .no-print {
            display: none !important;
          }
          @page {
            size: A4 landscape;
            margin: 10mm;
          }
        }
      `}</style>

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="no-print"
        style={{
          position: "fixed",
          right: 24,
          bottom: 24,
          zIndex: 900,
          border: 0,
          borderRadius: 12,
          padding: "13px 18px",
          background: "#1d4ed8",
          color: "white",
          fontWeight: 700,
          boxShadow: "0 10px 28px rgba(15, 23, 42, 0.22)",
          cursor: "pointer",
        }}
      >
        GPT-5 mini AI 비교
      </button>

      {open && (
        <div
          className="ai-compare-overlay"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(15, 23, 42, 0.48)",
            padding: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            className="ai-compare-modal"
            style={{
              width: "min(1120px, 96vw)",
              maxHeight: "92vh",
              overflow: "auto",
              background: "white",
              borderRadius: 16,
              padding: 24,
              boxShadow: "0 24px 70px rgba(15, 23, 42, 0.35)",
            }}
          >
            <div className="no-print">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start" }}>
                <div>
                  <p style={{ margin: 0, color: "#1d4ed8", fontSize: 12, fontWeight: 800, letterSpacing: 1 }}>
                    GPT-5 MINI PATENT COMPARE
                  </p>
                  <h2 style={{ margin: "6px 0 4px" }}>선택 특허 AI 비교</h2>
                  <p style={{ margin: 0, color: "#64748b" }}>
                    검색 결과에서 2~10건을 선택합니다. 저장된 공개공보 PDF가 있으면 청구항을 우선 반영하고, 없는 특허는 초록·IPC로 보완합니다.
                  </p>
                </div>
                <button type="button" onClick={() => setOpen(false)} style={{ border: 0, background: "transparent", fontSize: 24, cursor: "pointer" }} aria-label="AI 비교 창 닫기">
                  ×
                </button>
              </div>

              {!token && (
                <p style={{ marginTop: 18, padding: 12, background: "#fef2f2", color: "#991b1b", borderRadius: 10 }}>
                  작업 확인용 토큰이 없습니다. 결과 장표를 정상 경로로 다시 열어 주세요.
                </p>
              )}

              {loading && <p style={{ marginTop: 20 }}>특허 목록을 불러오는 중입니다...</p>}

              {!loading && token && patents.length > 0 && (
                <>
                  <div style={{ marginTop: 20, padding: 14, border: "1px solid #e2e8f0", borderRadius: 12, background: "#f8fafc" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                      <strong>비교 대상 선택</strong>
                      <span style={{ color: selectedIds.length >= 2 ? "#166534" : "#64748b", fontWeight: 700 }}>
                        {selectedIds.length}/10건 선택
                      </span>
                    </div>
                    <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: 12 }}>
                      성능을 위해 저장 PDF 청구항은 한 번에 최대 6건까지 우선 반영됩니다. 결과 상단에 실제 PDF 반영 건수가 표시됩니다.
                    </p>
                    <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(310px, 1fr))", gap: 8 }}>
                      {patents.map((patent) => (
                        <label
                          key={patent.id}
                          style={{
                            display: "flex",
                            gap: 10,
                            alignItems: "flex-start",
                            padding: 10,
                            border: selectedIds.includes(patent.id) ? "1px solid #2563eb" : "1px solid #e2e8f0",
                            borderRadius: 9,
                            background: selectedIds.includes(patent.id) ? "#eff6ff" : "white",
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(patent.id)}
                            onChange={() => togglePatent(patent.id)}
                            style={{ marginTop: 3 }}
                          />
                          <span>
                            <strong style={{ display: "block", fontSize: 14 }}>
                              {patent.display_order}. {patent.invention_title || "제목 없음"}
                            </strong>
                            <small style={{ color: "#64748b" }}>
                              {patent.applicant_name || "출원인 없음"} · {patent.ipc_number || "IPC 없음"}
                            </small>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "center", marginTop: 16 }}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedIds([]);
                        setResult(null);
                        setError("");
                      }}
                      style={{ padding: "10px 14px", border: "1px solid #cbd5e1", borderRadius: 9, background: "white", cursor: "pointer" }}
                    >
                      선택 초기화
                    </button>
                    <button
                      type="button"
                      onClick={compareSelected}
                      disabled={comparing || selectedIds.length < 2}
                      style={{
                        padding: "11px 16px",
                        border: 0,
                        borderRadius: 9,
                        background: comparing || selectedIds.length < 2 ? "#94a3b8" : "#1d4ed8",
                        color: "white",
                        fontWeight: 800,
                        cursor: comparing || selectedIds.length < 2 ? "not-allowed" : "pointer",
                      }}
                    >
                      {comparing ? "GPT-5 mini 분석 중..." : `선택 ${selectedIds.length}건 AI 비교`}
                    </button>
                  </div>
                </>
              )}

              {error && (
                <p style={{ marginTop: 16, padding: 12, background: "#fef2f2", color: "#991b1b", borderRadius: 10 }}>
                  {error}
                </p>
              )}
            </div>

            {result && (
              <article id="ai-compare-print-area" style={{ marginTop: 24, borderTop: "2px solid #0f172a", paddingTop: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <div>
                    <p style={{ margin: "0 0 4px", color: "#1d4ed8", fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>
                      KIPRIS PATENT AI COMPARE REPORT
                    </p>
                    <h2 style={{ margin: 0 }}>AI 비교 결과</h2>
                    <p style={{ color: "#64748b", margin: "5px 0 0" }}>
                      {result.model} · {result.compared_count}건 비교 · PDF 청구항 {result.pdf_claim_count}건 반영
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <span style={{ padding: "6px 10px", borderRadius: 999, background: "#eef2ff", color: "#3730a3", fontWeight: 700, fontSize: 12 }}>
                      {result.analysis_basis}
                    </span>
                    <button
                      type="button"
                      onClick={printComparison}
                      className="no-print"
                      style={{
                        padding: "9px 13px",
                        border: 0,
                        borderRadius: 9,
                        background: "#0f172a",
                        color: "white",
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      인쇄·PDF 저장
                    </button>
                  </div>
                </div>

                <section className="print-avoid-break" style={{ marginTop: 18, padding: 16, background: "#f8fafc", borderRadius: 12 }}>
                  <h3 style={{ marginTop: 0 }}>종합 요약</h3>
                  <p style={{ marginBottom: 0, lineHeight: 1.7 }}>{result.comparison.overall_summary}</p>
                </section>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, marginTop: 14 }}>
                  <section className="print-avoid-break" style={{ padding: 16, border: "1px solid #e2e8f0", borderRadius: 12 }}>
                    <h3 style={{ marginTop: 0 }}>공통 기술</h3>
                    <ul style={{ paddingLeft: 20, lineHeight: 1.7 }}>
                      {result.comparison.common_technologies.map((item, index) => <li key={index}>{item}</li>)}
                    </ul>
                  </section>
                  <section className="print-avoid-break" style={{ padding: 16, border: "1px solid #e2e8f0", borderRadius: 12 }}>
                    <h3 style={{ marginTop: 0 }}>핵심 차이</h3>
                    <ul style={{ paddingLeft: 20, lineHeight: 1.7 }}>
                      {result.comparison.key_differences.map((item, index) => <li key={index}>{item}</li>)}
                    </ul>
                  </section>
                </div>

                <section style={{ marginTop: 16 }}>
                  <h3>특허별 비교</h3>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                      <thead>
                        <tr>
                          {["특허", "출원인", "핵심 기술", "차별점", "그룹 유사도"].map((label) => (
                            <th key={label} style={{ textAlign: "left", padding: 10, borderBottom: "2px solid #cbd5e1", whiteSpace: "nowrap" }}>{label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.comparison.items.map((item) => (
                          <tr key={item.patent_id}>
                            <td style={{ padding: 10, verticalAlign: "top", borderBottom: "1px solid #e2e8f0", minWidth: 180 }}>
                              <strong>{item.title}</strong><br />
                              <small style={{ color: "#64748b" }}>ID {shortId(item.patent_id)}</small>
                            </td>
                            <td style={{ padding: 10, verticalAlign: "top", borderBottom: "1px solid #e2e8f0" }}>{item.applicant}</td>
                            <td style={{ padding: 10, verticalAlign: "top", borderBottom: "1px solid #e2e8f0", minWidth: 220 }}>{item.core_technology}</td>
                            <td style={{ padding: 10, verticalAlign: "top", borderBottom: "1px solid #e2e8f0", minWidth: 220 }}>{item.distinguishing_point}</td>
                            <td style={{ padding: 10, verticalAlign: "top", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap", fontWeight: 800 }}>{item.group_similarity_score}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                {result.comparison.claim_comparison.length > 0 && (
                  <section style={{ marginTop: 18 }}>
                    <h3>청구항 중심 비교</h3>
                    <p style={{ margin: "-4px 0 10px", color: "#64748b", fontSize: 12 }}>
                      공개공보 PDF가 제공된 특허는 청구항을 우선 분석하고, PDF가 없는 특허는 초록·IPC 기반 보완으로 표시합니다.
                    </p>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <thead>
                          <tr>
                            {["특허", "분석 근거", "독립청구항 중심", "핵심 구성요소", "타 특허 대비 차이"].map((label) => (
                              <th key={label} style={{ textAlign: "left", padding: 9, borderBottom: "2px solid #cbd5e1", whiteSpace: "nowrap" }}>{label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {result.comparison.claim_comparison.map((item) => (
                            <tr key={item.patent_id}>
                              <td style={{ padding: 9, verticalAlign: "top", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap", fontWeight: 700 }}>
                                {shortId(item.patent_id)}
                              </td>
                              <td style={{ padding: 9, verticalAlign: "top", borderBottom: "1px solid #e2e8f0", minWidth: 150 }}>{item.source_basis}</td>
                              <td style={{ padding: 9, verticalAlign: "top", borderBottom: "1px solid #e2e8f0", minWidth: 230 }}>{item.independent_claim_focus}</td>
                              <td style={{ padding: 9, verticalAlign: "top", borderBottom: "1px solid #e2e8f0", minWidth: 220 }}>
                                {item.key_elements.length > 0 ? item.key_elements.join(" · ") : "확인 가능한 구성요소 없음"}
                              </td>
                              <td style={{ padding: 9, verticalAlign: "top", borderBottom: "1px solid #e2e8f0", minWidth: 230 }}>{item.differences_vs_others}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                {result.comparison.similar_pairs.length > 0 && (
                  <section style={{ marginTop: 18 }}>
                    <h3>유사도가 높은 조합</h3>
                    <div style={{ display: "grid", gap: 8 }}>
                      {result.comparison.similar_pairs.map((pair, index) => (
                        <div key={index} className="print-avoid-break" style={{ padding: 12, border: "1px solid #e2e8f0", borderRadius: 10 }}>
                          <strong>{shortId(pair.left_patent_id)} ↔ {shortId(pair.right_patent_id)} · {pair.similarity_score}%</strong>
                          <p style={{ margin: "5px 0 0", lineHeight: 1.6 }}>{pair.reason}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {result.comparison.novelty_inventive_step_notes.length > 0 && (
                  <section className="print-avoid-break" style={{ marginTop: 18, padding: 16, background: "#eff6ff", borderRadius: 12 }}>
                    <h3 style={{ marginTop: 0 }}>신규성·진보성 검토 포인트</h3>
                    <ul style={{ paddingLeft: 20, lineHeight: 1.7, marginBottom: 0 }}>
                      {result.comparison.novelty_inventive_step_notes.map((item, index) => <li key={index}>{item}</li>)}
                    </ul>
                  </section>
                )}

                <section className="print-avoid-break" style={{ marginTop: 18, padding: 16, background: "#fffbeb", borderRadius: 12 }}>
                  <h3 style={{ marginTop: 0 }}>추가 검토 사항</h3>
                  <ul style={{ paddingLeft: 20, lineHeight: 1.7 }}>
                    {result.comparison.review_notes.map((item, index) => <li key={index}>{item}</li>)}
                  </ul>
                  <p style={{ marginBottom: 0, color: "#92400e" }}>
                    <strong>분석 한계:</strong> {result.comparison.limitations}
                  </p>
                </section>

                {selectedPatents.length > 0 && (
                  <p style={{ marginTop: 14, color: "#64748b", fontSize: 12 }}>
                    비교 대상: {selectedPatents.map((patent) => patent.invention_title || patent.application_number).join(" · ")}
                  </p>
                )}
              </article>
            )}
          </section>
        </div>
      )}
    </>
  );
}
