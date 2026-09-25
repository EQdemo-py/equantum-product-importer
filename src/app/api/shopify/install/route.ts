import { NextResponse } from "next/server";
import crypto from "node:crypto";

export const runtime = "nodejs";

function normalizeShop(shop: string) {
  return shop
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

export async function GET() {
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const shop = normalizeShop(process.env.SHOPIFY_SHOP || "");
  const scopes = process.env.SHOPIFY_SCOPES || "read_products,write_products";
  const appUrl = process.env.SHOPIFY_APP_URL?.replace(/\/$/, "");

  if (!clientId || !shop || !appUrl) {
    return NextResponse.json(
      { error: "Falta configuración de Shopify en .env.local" },
      { status: 500 }
    );
  }

  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
    return NextResponse.json(
      { error: "SHOPIFY_SHOP no es válido" },
      { status: 400 }
    );
  }

  const state = crypto.randomBytes(24).toString("hex");
  const redirectUri = `${appUrl}/api/shopify/callback`;

  const authorizeUrl = new URL(
    `https://${shop}/admin/oauth/authorize`
  );

  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("scope", scopes);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authorizeUrl);

  response.cookies.set("shopify_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return response;
}
