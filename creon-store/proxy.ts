import { NextRequest, NextResponse } from "next/server";

const isCrePurchasePath = (pathname: string): boolean =>
  pathname === "/api/cre/purchase";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith("/api/cre/")) {
    return NextResponse.next();
  }

  if (request.method !== "POST") {
    return NextResponse.json(
      { error: "method not allowed", allowed: ["POST"] },
      { status: 405 },
    );
  }

  if (isCrePurchasePath(pathname)) {
    const paymentHeader =
      request.headers.get("x-payment") ??
      request.headers.get("x-x402-payment") ??
      "";

    if (!paymentHeader) {
      return NextResponse.json(
        {
          error: "payment required",
          message: "x402 payment header missing",
        },
        {
          status: 402,
          headers: {
            "x-payment-required": "x402",
          },
        },
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/cre/:path*"],
};
