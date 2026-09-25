type ProductForAI = {
  sku: string;
  description?: string | null;
  collection?: string | null;
  series?: string | null;
  gender?: string | null;
  case_size?: string | null;
  case_material?: string | null;
  bezel_material?: string | null;
  bezel_color?: string | null;
  crown_type?: string | null;
  crystal_type?: string | null;
  dial_material?: string | null;
  caliber?: string | null;
  movement?: string | null;
  water_resistance?: string | null;
  band_material?: string | null;
  band_tone?: string | null;
  band_length?: string | null;
  band_size?: string | null;
};

export type CommercialProductContent = {
  title: string;
  shortDescription: string;
  descriptionHtml: string;
  productType: string;
  vendor: string;
  collection: string;
  tags: string[];
  seo: {
    title: string;
    description: string;
  };
  validation: {
    approved: boolean;
    notes: string;
  };
};

const GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-flash-lite-latest",
];
const MAX_ATTEMPTS = 3;

function normalizeTitle(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/\bTECHNOMARINE\b/gi, "Technomarine")
    .replace(/\bMEN\b/gi, "Men")
    .replace(/\bWOMEN\b/gi, "Women")
    .replace(/(\d+(?:\.\d+)?)\s*MM\b/gi, "$1mm")
    .trim();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasSuspiciousSourceValue(product: ProductForAI) {
  const waterResistance = String(product.water_resistance || "").trim();

  // Ejemplo detectado en la fuente: "5ATMm".
  // No bloqueamos todo el producto; evitamos que la IA interprete
  // este valor como una especificación válida.
  if (
    waterResistance &&
    !/^(\d+(?:\.\d+)?)\s*(ATM|BAR|M|METERS?|METROS?)$/i.test(
      waterResistance
    )
  ) {
    return {
      field: "water_resistance",
      value: waterResistance,
    };
  }

  return null;
}

async function callGemini(apiKey: string, prompt: string) {
  let lastError = "Error desconocido de Gemini.";

  for (const model of GEMINI_MODELS) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: prompt }],
              },
            ],
            generationConfig: {
              temperature: 0.3,
              responseMimeType: "application/json",
            },
          }),
        }
      );

      const result = await response.json();

      if (response.ok) {
        return result;
      }

      lastError =
        result?.error?.message ||
        `Gemini respondió con error ${response.status}`;

      const retryable =
        response.status === 429 ||
        response.status === 500 ||
        response.status === 502 ||
        response.status === 503 ||
        response.status === 504 ||
        /high demand|temporar|overloaded|unavailable/i.test(lastError);

      if (!retryable) {
        throw new Error(lastError);
      }

      if (attempt < MAX_ATTEMPTS) {
        await sleep(attempt * 1500);
      }
    }
  }

  throw new Error(
    `Gemini no está disponible después de probar los modelos configurados. Último error: ${lastError}`
  );
}

export async function generateCommercialProductContent(
  product: ProductForAI
): Promise<CommercialProductContent> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("Falta GEMINI_API_KEY en el entorno del servidor.");
  }

  if (!product.sku?.trim()) {
    throw new Error("El producto no tiene SKU.");
  }

  const suspicious = hasSuspiciousSourceValue(product);

  const safeProduct: ProductForAI = {
    ...product,
    water_resistance:
      suspicious?.field === "water_resistance"
        ? null
        : product.water_resistance,
  };

  const sourceWarning = suspicious
    ? `ADVERTENCIA DE FUENTE: El campo "${suspicious.field}" contiene el valor "${suspicious.value}", que parece mal formado. Fue excluido de los datos utilizables. NO lo interpretes, corrijas ni menciones.`
    : "No se detectaron valores sospechosos en los campos validados.";

  const prompt = `
Sos el editor ecommerce senior de UltraMaison Colombia.

Tu trabajo es preparar un reloj Technomarine para venderlo en Shopify.

REGLAS OBLIGATORIAS:

1. Los datos recibidos son la única fuente de verdad.
2. NO inventes características.
3. NO cambies el SKU.
4. NO inventes materiales, funciones, colores, resistencia al agua,
   movimiento, garantía, procedencia ni beneficios técnicos.
5. Si no conocés un dato, omitilo.
6. No interpretes ni corrijas valores dudosos de la fuente.
7. El nombre NO debe estar completamente en mayúsculas.
8. Usá capitalización natural y comercial.

Formato recomendado:

Technomarine [Colección] [Men/Women] [Medida] – [SKU]

Ejemplo:

Technomarine Lusso Mare Men 44.00mm – TM-226002

9. La descripción debe estar escrita en español comercial profesional.
10. Debe sonar como una tienda especializada en relojería.
11. Evitá afirmaciones subjetivas o técnicas que no estén respaldadas
    directamente por los datos.
12. NO uses afirmaciones como "confiable", "preciso", "premium",
    "resistente", "ideal para", "perfecto para" o similares si la ficha
    no aporta información que las respalde.
13. NO repitas todas las especificaciones técnicas dentro de la descripción.
    El sistema las agregará después.
14. No agregues garantía, procedencia, autenticidad, funciones o prestaciones
    que no estén presentes en los datos.
15. Revisá tu propio contenido antes de aprobarlo.
16. validation.approved debe ser TRUE solamente si no inventaste,
    interpretaste ni contradijiste ningún dato.

CAMPOS PARA SHOPIFY:

17. productType debe ser exactamente "Reloj".
18. vendor debe ser exactamente "Technomarine".
19. collection debe copiar EXACTAMENTE la colección recibida en los datos.
20. tags debe contener solamente datos comprobables del producto.
21. Podés usar como tags: SKU, Technomarine, colección, género, medida,
    material de caja, movimiento, calibre y material de correa cuando existan.
22. NO inventes tags.
23. seo.title debe ser natural, comercial y contener el SKU exacto.
24. seo.description debe ser una descripción breve para Google basada
    exclusivamente en información real del producto.
25. NO generes precio, inventario, peso, código de barras ni país de origen.

${sourceWarning}

Respondé EXCLUSIVAMENTE JSON:

{
  "title": "Nombre comercial",
  "shortDescription": "Resumen comercial de máximo 260 caracteres",
  "descriptionHtml": "<p>Descripción comercial...</p>",
  "productType": "Reloj",
  "vendor": "Technomarine",
  "collection": "Colección exacta de la fuente",
  "tags": [
    "Technomarine",
    "SKU",
    "Colección"
  ],
  "seo": {
    "title": "Título SEO con SKU",
    "description": "Meta descripción comercial"
  },
  "validation": {
    "approved": true,
    "notes": "Contenido contrastado con la ficha original."
  }
}

DATOS REALES DEL PRODUCTO:

${JSON.stringify(
  {
    brand: "Technomarine",
    ...safeProduct,
  },
  null,
  2
)}
`;

  const result = await callGemini(apiKey, prompt);

  const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error("Gemini no devolvió contenido.");
  }

  let generated: CommercialProductContent;

  try {
    generated = JSON.parse(text);
  } catch {
    throw new Error("Gemini devolvió una respuesta JSON inválida.");
  }

  generated.title = normalizeTitle(String(generated.title || ""));
  generated.shortDescription = String(
    generated.shortDescription || ""
  ).trim();
  generated.descriptionHtml = String(
    generated.descriptionHtml || ""
  ).trim();

  generated.productType = String(generated.productType || "").trim();
  generated.vendor = String(generated.vendor || "").trim();
  generated.collection = String(generated.collection || "").trim();

  generated.tags = Array.isArray(generated.tags)
    ? generated.tags
        .map((tag) => String(tag || "").trim())
        .filter(Boolean)
    : [];

  generated.seo = {
    title: String(generated.seo?.title || "").trim(),
    description: String(generated.seo?.description || "").trim(),
  };

  const exactSku = product.sku.trim();

  if (!generated.title) {
    throw new Error("La IA no generó un título.");
  }

  if (!generated.title.toUpperCase().includes(exactSku.toUpperCase())) {
    throw new Error("La IA modificó o eliminó el SKU.");
  }

  if (!generated.title.toLowerCase().includes("technomarine")) {
    throw new Error("La IA eliminó la marca Technomarine del título.");
  }

  if (
    product.collection &&
    !generated.title
      .toLowerCase()
      .includes(product.collection.trim().toLowerCase())
  ) {
    throw new Error("La IA eliminó la colección del título.");
  }

  if (
    product.case_size &&
    !generated.title
      .toLowerCase()
      .includes(product.case_size.trim().toLowerCase())
  ) {
    throw new Error("La IA eliminó la medida de caja del título.");
  }

  if (!generated.shortDescription) {
    throw new Error("La IA no generó la descripción corta.");
  }

  if (generated.shortDescription.length > 260) {
    throw new Error("La descripción corta supera los 260 caracteres.");
  }

  if (!generated.descriptionHtml) {
    throw new Error("La IA no generó la descripción.");
  }

  if (generated.productType !== "Reloj") {
    throw new Error("Gemini devolvió un tipo de producto inválido.");
  }

  if (generated.vendor !== "Technomarine") {
    throw new Error("Gemini devolvió un proveedor inválido.");
  }

  if (
    product.collection &&
    generated.collection.toLowerCase() !==
      product.collection.trim().toLowerCase()
  ) {
    throw new Error("Gemini modificó la colección original.");
  }

  if (!generated.tags.length) {
    throw new Error("Gemini no generó etiquetas válidas.");
  }

  if (!generated.seo.title) {
    throw new Error("Gemini no generó el título SEO.");
  }

  if (
    !generated.seo.title
      .toUpperCase()
      .includes(exactSku.toUpperCase())
  ) {
    throw new Error("El título SEO no contiene el SKU exacto.");
  }

  if (!generated.seo.description) {
    throw new Error("Gemini no generó la descripción SEO.");
  }

  if (generated.validation?.approved !== true) {
    throw new Error(
      `La IA rechazó el contenido: ${
        generated.validation?.notes || "requiere revisión"
      }`
    );
  }

  return generated;
}
