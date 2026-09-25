"use client";

import { useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Loader2,
  PackageSearch,
  Play,
  RotateCcw,
  Trash2,
} from "lucide-react";

type Status = "pending" | "processing" | "completed" | "error";

type ImportItem = {
  sku: string;
  status: Status;
  product?: {
    sku: string;
    name: string;
    collection: string | null;
    series: string | null;
    gender: string | null;
    price: number | null;
    currency: string;
    mainImage: string | null;
    images: Array<{
      position: number;
      type: string;
      url: string;
    }>;
    technical: {
      caseSize: string | null;
      movement: string | null;
      waterResistance: string | null;
      bandMaterial: string | null;
      bandTone: string | null;
    };
  };
  error?: string;
  shopifyStatus?: "idle" | "sending" | "sent" | "error";
  shopifyError?: string;
  shopifyProductId?: string;
  aiStatus?: "idle" | "generating" | "ready" | "error";
  aiError?: string;
  aiContent?: {
    title: string;
    shortDescription: string;
    descriptionHtml: string;
    validation: {
      approved: boolean;
      notes: string;
    };
  };
};

function extractSkus(value: string) {
  const matches = value.toUpperCase().match(/TM-\d+/g) ?? [];
  return [...new Set(matches)];
}

export default function ProductImporter() {
  const [input, setInput] = useState("");
  const [items, setItems] = useState<ImportItem[]>([]);
  const [running, setRunning] = useState(false);
  const [sendingSku, setSendingSku] = useState<string | null>(null);
  const [generatingSku, setGeneratingSku] = useState<string | null>(null);
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [bulkSending, setBulkSending] = useState(false);

  const detectedSkus = useMemo(() => extractSkus(input), [input]);

  const completed = items.filter((item) => item.status === "completed").length;
  const errors = items.filter((item) => item.status === "error").length;

  function prepareImport() {
    setItems(
      detectedSkus.map((sku) => ({
        sku,
        status: "pending",
      }))
    );
  }

  async function processProducts() {
    if (!detectedSkus.length) return;

    const initialItems: ImportItem[] =
      items.length > 0
        ? items
        : detectedSkus.map((sku) => ({
            sku,
            status: "pending",
          }));

    setItems(initialItems);
    setRunning(true);

    const productsToSave: NonNullable<ImportItem["product"]>[] = [];

    for (const current of initialItems) {
      if (current.status === "completed" && current.product) {
        productsToSave.push(current.product);
        continue;
      }

      setItems((previous) =>
        previous.map((item) =>
          item.sku === current.sku
            ? { ...item, status: "processing", error: undefined }
            : item
        )
      );

      try {
        const response = await fetch(
          `/api/extract?sku=${encodeURIComponent(current.sku)}`
        );

        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.error || "No se pudo procesar el producto");
        }

        productsToSave.push(data.product);

        setItems((previous) =>
          previous.map((item) =>
            item.sku === current.sku
              ? {
                  ...item,
                  status: "completed",
                  product: data.product,
                  error: undefined,
                }
              : item
          )
        );
      } catch (error) {
        setItems((previous) =>
          previous.map((item) =>
            item.sku === current.sku
              ? {
                  ...item,
                  status: "error",
                  error:
                    error instanceof Error
                      ? error.message
                      : "Error desconocido",
                }
              : item
          )
        );
      }
    }

    try {
      if (productsToSave.length > 0) {
        const saveResponse = await fetch("/api/imports/create", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: `UltraMaison - ${new Date().toLocaleDateString("es-PY")}`,
            products: productsToSave,
          }),
        });

        const saveData = await saveResponse.json();

        if (!saveResponse.ok) {
          throw new Error(
            saveData.error || "No se pudo guardar la importación en Supabase"
          );
        }

        console.log("Importación guardada:", saveData);
      }
    } catch (error) {
      console.error("Error guardando en Supabase:", error);
      alert(
        error instanceof Error
          ? `Los productos se procesaron, pero no se pudieron guardar: ${error.message}`
          : "Los productos se procesaron, pero no se pudieron guardar en Supabase."
      );
    } finally {
      setRunning(false);
    }
  }

  async function generateWithGemini(sku: string) {
    if (generatingSku) return;

    setGeneratingSku(sku);

    setItems((previous) =>
      previous.map((item) =>
        item.sku === sku
          ? {
              ...item,
              aiStatus: "generating",
              aiError: undefined,
            }
          : item
      )
    );

    try {
      const response = await fetch("/api/ai/test-product", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sku }),
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Gemini no pudo generar el contenido.");
      }

      setItems((previous) =>
        previous.map((item) =>
          item.sku === sku
            ? {
                ...item,
                aiStatus: "ready",
                aiContent: data.commercialContent,
                aiError: undefined,
              }
            : item
        )
      );

      return {
        ok: true,
        approved: Boolean(data.commercialContent?.validation?.approved),
      };
    } catch (error) {
      setItems((previous) =>
        previous.map((item) =>
          item.sku === sku
            ? {
                ...item,
                aiStatus: "error",
                aiError:
                  error instanceof Error
                    ? error.message
                    : "Error generando contenido con Gemini.",
              }
            : item
        )
      );

      return { ok: false, approved: false };
    } finally {
      setGeneratingSku(null);
    }
  }

  async function sendToShopify(sku: string) {
    if (sendingSku) return;

    setSendingSku(sku);

    setItems((previous) =>
      previous.map((item) =>
        item.sku === sku
          ? {
              ...item,
              shopifyStatus: "sending",
              shopifyError: undefined,
            }
          : item
      )
    );

    try {
      const response = await fetch("/api/shopify/send-product", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sku }),
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        const details = Array.isArray(data.details)
          ? data.details
              .map((detail: { message?: string }) => detail?.message)
              .filter(Boolean)
              .join(" | ")
          : "";

        throw new Error(
          details
            ? `${data.error || "Shopify rechazó el producto"} ${details}`
            : data.error || "No se pudo enviar a Shopify."
        );
      }

      setItems((previous) =>
        previous.map((item) =>
          item.sku === sku
            ? {
                ...item,
                shopifyStatus: "sent",
                shopifyProductId: data.shopify?.productId,
                shopifyError: undefined,
              }
            : item
        )
      );
    } catch (error) {
      setItems((previous) =>
        previous.map((item) =>
          item.sku === sku
            ? {
                ...item,
                shopifyStatus: "error",
                shopifyError:
                  error instanceof Error
                    ? error.message
                    : "Error enviando a Shopify.",
              }
            : item
        )
      );
    } finally {
      setSendingSku(null);
    }
  }

  async function generateAllWithGemini() {
    if (bulkGenerating || bulkSending) return;

    const candidates = items.filter(
      (item) => item.status === "completed" && item.aiStatus !== "ready"
    );

    if (!candidates.length) return;

    setBulkGenerating(true);

    try {
      for (const item of candidates) {
        await generateWithGemini(item.sku);

        // Pausa pequeña para no golpear la API de Gemini demasiado rápido.
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
    } finally {
      setBulkGenerating(false);
    }
  }

  async function sendApprovedToShopify() {
    if (bulkSending || bulkGenerating) return;

    const approvedItems = items.filter(
      (item) =>
        item.status === "completed" &&
        item.aiStatus === "ready" &&
        item.aiContent?.validation?.approved === true &&
        item.shopifyStatus !== "sent"
    );

    if (!approvedItems.length) return;

    const confirmed = window.confirm(
      `Se enviarán ${approvedItems.length} productos aprobados a Shopify como borrador. ¿Continuar?`
    );

    if (!confirmed) return;

    setBulkSending(true);

    try {
      for (const item of approvedItems) {
        await sendToShopify(item.sku);

        // Shopify se procesa en cola para evitar llamadas simultáneas.
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } finally {
      setBulkSending(false);
    }
  }

  function reset() {
    setInput("");
    setItems([]);
  }

  return (
    <main className="min-h-screen bg-[#f6f8fc] text-[#02080D]">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#4770DB]">
              eQuantum
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">
              Product Importer
            </h1>
          </div>

          <div className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-600">
            Technomarine → Shopify
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-10">
        <section className="mb-8">
          <h2 className="text-3xl font-semibold tracking-tight">
            Importar productos
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Pegá los enlaces o códigos SKU de Technomarine. El sistema detecta
            los productos y obtiene automáticamente la información disponible.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-sm font-medium text-slate-500">
              Productos detectados
            </p>
            <p className="mt-2 text-3xl font-semibold">
              {detectedSkus.length}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-sm font-medium text-slate-500">
              Procesados correctamente
            </p>
            <p className="mt-2 text-3xl font-semibold">{completed}</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-sm font-medium text-slate-500">
              Requieren revisión
            </p>
            <p className="mt-2 text-3xl font-semibold">{errors}</p>
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#4770DB]/10 text-[#4770DB]">
              <PackageSearch size={20} />
            </div>

            <div>
              <h3 className="font-semibold">Productos de Technomarine</h3>
              <p className="text-sm text-slate-500">
                Podés pegar un enlace por línea o directamente los SKU.
              </p>
            </div>
          </div>

          <textarea
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setItems([]);
            }}
            disabled={running}
            placeholder={`https://www.technomarine.com/watches/TM-724002
https://www.technomarine.com/watches/TM-725061
TM-719022`}
            className="min-h-52 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-sm leading-7 outline-none transition focus:border-[#4770DB] focus:bg-white focus:ring-4 focus:ring-[#4770DB]/10 disabled:opacity-60"
          />

          <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-slate-500">
              <strong className="text-[#02080D]">{detectedSkus.length}</strong>{" "}
              productos únicos detectados.
            </p>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={reset}
                disabled={running}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold transition hover:bg-slate-50 disabled:opacity-50"
              >
                <Trash2 size={16} />
                Limpiar
              </button>

              <button
                type="button"
                onClick={prepareImport}
                disabled={!detectedSkus.length || running}
                className="inline-flex items-center gap-2 rounded-xl border border-[#4770DB]/20 bg-[#4770DB]/5 px-4 py-2.5 text-sm font-semibold text-[#4770DB] transition hover:bg-[#4770DB]/10 disabled:opacity-50"
              >
                <CheckCircle2 size={16} />
                Preparar
              </button>

              <button
                type="button"
                onClick={processProducts}
                disabled={!detectedSkus.length || running}
                className="inline-flex items-center gap-2 rounded-xl bg-[#02080D] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0E81F0] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {running ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Procesando...
                  </>
                ) : (
                  <>
                    <Play size={16} />
                    Procesar productos
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={async () => {
                  try {
                    const response = await fetch("/api/exports/shopify-csv");

                    if (!response.ok) {
                      const data = await response.json().catch(() => null);
                      throw new Error(
                        data?.error || `Error al exportar (${response.status})`
                      );
                    }

                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);

                    const link = document.createElement("a");
                    link.href = url;
                    link.download = `ultramaison-shopify-${new Date()
                      .toISOString()
                      .slice(0, 10)}.csv`;

                    document.body.appendChild(link);
                    link.click();
                    link.remove();

                    window.URL.revokeObjectURL(url);
                  } catch (error) {
                    console.error("Error exportando Shopify CSV:", error);
                    alert(
                      error instanceof Error
                        ? error.message
                        : "No se pudo exportar el CSV."
                    );
                  }
                }}
                disabled={running}
                className="inline-flex items-center gap-2 rounded-xl bg-[#4770DB] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0E81F0] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Exportar Shopify CSV
              </button>
            </div>
          </div>
        </section>

        {items.length > 0 && (
          <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
              <div>
                <h3 className="font-semibold">Resultado de la importación</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Información obtenida directamente desde Technomarine.
                </p>
              </div>

              {errors > 0 && !running && (
                <button
                  type="button"
                  onClick={processProducts}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-[#4770DB]"
                >
                  <RotateCcw size={15} />
                  Reintentar errores
                </button>
              )}
            </div>

            <div className="border-b border-slate-200 bg-slate-50/70 px-6 py-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <h4 className="font-semibold">Automatización masiva</h4>
                  <p className="mt-1 text-sm text-slate-500">
                    Generá el contenido de todos los productos con Gemini y enviá
                    a Shopify únicamente los aprobados.
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-white px-3 py-1.5 font-semibold text-slate-600">
                      {items.filter((item) => item.status === "completed").length} procesados
                    </span>

                    <span className="rounded-full bg-violet-50 px-3 py-1.5 font-semibold text-violet-700">
                      {
                        items.filter((item) => item.aiStatus === "ready").length
                      } generados con Gemini
                    </span>

                    <span className="rounded-full bg-emerald-50 px-3 py-1.5 font-semibold text-emerald-700">
                      {
                        items.filter(
                          (item) =>
                            item.aiStatus === "ready" &&
                            item.aiContent?.validation?.approved === true
                        ).length
                      } aprobados
                    </span>

                    <span className="rounded-full bg-blue-50 px-3 py-1.5 font-semibold text-blue-700">
                      {
                        items.filter((item) => item.shopifyStatus === "sent")
                          .length
                      } enviados
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={generateAllWithGemini}
                    disabled={
                      bulkGenerating ||
                      bulkSending ||
                      !items.some(
                        (item) =>
                          item.status === "completed" &&
                          item.aiStatus !== "ready"
                      )
                    }
                    className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {bulkGenerating ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Generando todos...
                      </>
                    ) : (
                      <>✨ Generar todos con Gemini</>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={sendApprovedToShopify}
                    disabled={
                      bulkGenerating ||
                      bulkSending ||
                      !items.some(
                        (item) =>
                          item.aiStatus === "ready" &&
                          item.aiContent?.validation?.approved === true &&
                          item.shopifyStatus !== "sent"
                      )
                    }
                    className="inline-flex items-center gap-2 rounded-xl bg-[#02080D] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#0E81F0] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {bulkSending ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Enviando aprobados...
                      </>
                    ) : (
                      <>Enviar aprobados a Shopify</>
                    )}
                  </button>
                </div>
              </div>

              {bulkGenerating && (
                <div className="mt-4">
                  <div className="mb-2 flex justify-between text-xs font-medium text-slate-500">
                    <span>Gemini está procesando la cola</span>
                    <span>
                      {items.filter((item) => item.aiStatus === "ready").length} /{" "}
                      {items.filter((item) => item.status === "completed").length}
                    </span>
                  </div>

                  <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full bg-violet-600 transition-all duration-500"
                      style={{
                        width: `${
                          items.filter((item) => item.status === "completed")
                            .length
                            ? Math.round(
                                (items.filter(
                                  (item) => item.aiStatus === "ready"
                                ).length /
                                  items.filter(
                                    (item) => item.status === "completed"
                                  ).length) *
                                  100
                              )
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-left">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-6 py-4 font-semibold">Producto</th>
                    <th className="px-4 py-4 font-semibold">SKU</th>
                    <th className="px-4 py-4 font-semibold">Colección</th>
                    <th className="px-4 py-4 font-semibold">Precio fuente</th>
                    <th className="px-4 py-4 font-semibold">Imágenes</th>
                    <th className="px-6 py-4 font-semibold">Estado</th>
                    <th className="px-6 py-4 font-semibold">Shopify</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {items.map((item) => (
                    <tr key={item.sku} className="hover:bg-slate-50/70">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          {item.product?.mainImage ? (
                            <img
                              src={item.product.mainImage}
                              alt={item.product.name}
                              className="h-14 w-14 rounded-xl border border-slate-200 bg-white object-contain"
                            />
                          ) : (
                            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                              <PackageSearch size={20} />
                            </div>
                          )}

                          <div>
                            <p className="font-semibold">
                              {item.product?.name || "Pendiente"}
                            </p>
                            {item.product?.technical?.caseSize && (
                              <p className="mt-1 text-xs text-slate-500">
                                {item.product.technical.caseSize}
                                {item.product.technical.bandTone
                                  ? ` · ${item.product.technical.bandTone}`
                                  : ""}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-4 font-mono text-sm">
                        {item.sku}
                      </td>

                      <td className="px-4 py-4 text-sm">
                        {item.product?.collection || "—"}
                      </td>

                      <td className="px-4 py-4 text-sm font-semibold">
                        {item.product?.price != null
                          ? `${item.product.currency} ${item.product.price}`
                          : "—"}
                      </td>

                      <td className="px-4 py-4 text-sm">
                        {item.product?.images?.length ?? "—"}
                      </td>

                      <td className="px-6 py-4">
                        {item.status === "pending" && (
                          <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">
                            Pendiente
                          </span>
                        )}

                        {item.status === "processing" && (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">
                            <Loader2 size={12} className="animate-spin" />
                            Procesando
                          </span>
                        )}

                        {item.status === "completed" && (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                            <CheckCircle2 size={12} />
                            Listo
                          </span>
                        )}

                        {item.status === "error" && (
                          <div>
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700">
                              <CircleAlert size={12} />
                              Error
                            </span>
                            {item.error && (
                              <p className="mt-2 max-w-xs text-xs text-red-600">
                                {item.error}
                              </p>
                            )}
                          </div>
                        )}
                      </td>

                      <td className="px-6 py-4">
                        {item.status !== "completed" ? (
                          <span className="text-xs text-slate-400">
                            No disponible
                          </span>
                        ) : item.shopifyStatus === "sent" ? (
                          <div>
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                              <CheckCircle2 size={12} />
                              Enviado
                            </span>
                            <p className="mt-1 text-xs text-slate-400">
                              Borrador en Shopify
                            </p>
                          </div>
                        ) : item.shopifyStatus === "error" ? (
                          <div>
                            <button
                              type="button"
                              onClick={() => sendToShopify(item.sku)}
                              disabled={Boolean(sendingSku)}
                              className="rounded-xl bg-red-50 px-4 py-2.5 text-xs font-semibold text-red-700 disabled:opacity-50"
                            >
                              Reintentar
                            </button>

                            {item.shopifyError && (
                              <p className="mt-2 max-w-[220px] text-xs text-red-600">
                                {item.shopifyError}
                              </p>
                            )}
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => sendToShopify(item.sku)}
                            disabled={Boolean(sendingSku)}
                            className="inline-flex whitespace-nowrap items-center gap-2 rounded-xl bg-[#4770DB] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-[#0E81F0] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {item.shopifyStatus === "sending" ? (
                              <>
                                <Loader2 size={14} className="animate-spin" />
                                Enviando...
                              </>
                            ) : (
                              <>Enviar a Shopify</>
                            )}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {items
              .filter((item) => item.status === "completed")
              .map((item) => (
                <div
                  key={`ai-${item.sku}`}
                  className="border-t border-slate-200 px-6 py-6"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-bold text-violet-700">
                          GEMINI AI
                        </span>
                        <span className="font-mono text-xs text-slate-400">
                          {item.sku}
                        </span>
                      </div>

                      <h4 className="mt-3 text-lg font-semibold">
                        Contenido comercial
                      </h4>
                      <p className="mt-1 text-sm text-slate-500">
                        Gemini mejora el título y la descripción usando únicamente
                        los datos técnicos obtenidos del producto.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => generateWithGemini(item.sku)}
                      disabled={Boolean(generatingSku)}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {item.aiStatus === "generating" ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          Generando...
                        </>
                      ) : item.aiStatus === "ready" ? (
                        <>
                          <RotateCcw size={16} />
                          Regenerar con Gemini
                        </>
                      ) : (
                        <>✨ Generar con Gemini</>
                      )}
                    </button>
                  </div>

                  {item.aiStatus === "error" && (
                    <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4">
                      <p className="text-sm font-semibold text-red-700">
                        No se pudo generar el contenido
                      </p>
                      <p className="mt-1 text-sm text-red-600">
                        {item.aiError}
                      </p>
                    </div>
                  )}

                  {item.aiStatus === "ready" && item.aiContent && (
                    <div className="mt-6 grid gap-4">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                          Título sugerido
                        </p>
                        <p className="mt-2 text-lg font-semibold">
                          {item.aiContent.title}
                        </p>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-white p-5">
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                          Descripción corta
                        </p>
                        <p className="mt-2 text-sm leading-6 text-slate-700">
                          {item.aiContent.shortDescription}
                        </p>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-white p-5">
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                          Descripción comercial
                        </p>
                        <div
                          className="mt-3 space-y-3 text-sm leading-7 text-slate-700"
                          dangerouslySetInnerHTML={{
                            __html: item.aiContent.descriptionHtml,
                          }}
                        />
                      </div>

                      <div
                        className={`rounded-xl border p-4 ${
                          item.aiContent.validation.approved
                            ? "border-emerald-200 bg-emerald-50"
                            : "border-amber-200 bg-amber-50"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {item.aiContent.validation.approved ? (
                            <CheckCircle2
                              size={18}
                              className="text-emerald-700"
                            />
                          ) : (
                            <CircleAlert
                              size={18}
                              className="text-amber-700"
                            />
                          )}

                          <p
                            className={`text-sm font-semibold ${
                              item.aiContent.validation.approved
                                ? "text-emerald-800"
                                : "text-amber-800"
                            }`}
                          >
                            {item.aiContent.validation.approved
                              ? "Contenido validado"
                              : "Requiere revisión"}
                          </p>
                        </div>

                        <p className="mt-2 text-sm text-slate-600">
                          {item.aiContent.validation.notes}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
          </section>
        )}
      </div>
    </main>
  );
}
