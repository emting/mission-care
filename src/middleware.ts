import {NextResponse} from 'next/server';
export function middleware() {
  const response=NextResponse.next();
  response.headers.set('Cache-Control','private, no-store, no-cache, max-age=0, must-revalidate');
  response.headers.set('Pragma','no-cache');
  return response;
}
export const config={matcher:['/app/:path*']};
