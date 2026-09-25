import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function verifyHmac(searchParams: URLSearchParams, secret: string) {
  const hmac = searchParams.get("hmac");

  if (!hmac) return false;

  const params = new URLSearchParams(searchParams);
  params.delete("hmac");
  params.delete("signature");

  const message = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  const digest = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(digest, "utf8"),
      Buffer.from(hmac, "utf8")
    );
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  try {
    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
    const expectedShop = process.env.SHOPIFY_SHOP?.toLowerCase();

    if (!clientId || !clientSecret || !expectedShop) {
      throw new Error("Falta configuración de Shopify.");
    }

    const params = request.nextUrl.searchParams;

    const shop = params.get("shop")?.toLowerCase();
    const code = params.get("code");
    const state = params.get("state");
    const savedState = request.cookies.get("shopify_oauth_state")?.value;

    if (!shop || !code || !state) {
      throw new Error("Respuesta OAuth incompleta.");
    }

    if (shop !== expectedShop) {
      throw new Error("La tienda recibida no corresponde a UltraMaison.");
    }

    if (!savedState || state !== savedState) {
      throw new Error("Estado OAuth inválido.");
    }

    if (!verifyHmac(params, clientSecret)) {
      throw new Error("Firma HMAC de Shopify inválida.");
    }

    const tokenResponse = await fetch(
      `https://${shop}/admin/oauth/access_token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error("Shopify token exchange failed:", tokenResponse.status);
      throw new Error("Shopify no entregó el access token.");
    }

    const supabase = createServerSupabaseClient();

    const { error: saveError } = await supabase
      .from("shopify_connections")
      .upsert(
        {
          shop,
          access_token: tokenData.access_token,
          scopes: tokenData.scope ?? "",
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "shop",
        }
      );

    if (saveError) {
      console.error("Error guardando conexión Shopify:", saveError);
      throw new Error(
        `No se pudo guardar la conexión de Shopify: ${saveError.message}`
      );
    }

    const response = NextResponse.json({
      ok: true,
      message: "UltraMaison conectada permanentemente con Shopify.",
      shop,
      scope: tokenData.scope ?? "",
      saved: true,
    });

    response.cookies.delete("shopify_oauth_state");
    response.cookies.delete("shopify_access_token");

    return response;
  } catch (error) {
    console.error("Shopify OAuth callback:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "No se pudo conectar Shopify.",
      },
      { status: 400 }
    );
  }
}
