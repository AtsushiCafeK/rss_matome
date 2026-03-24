import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      next: { revalidate: 3600 } // Cache for 1 hour
    });

    if (!response.ok) throw new Error('Failed to fetch page');
    const html = await response.text();

    // Simple regex to find og:image
    const ogImageMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^">]+)"/) ||
                       html.match(/<meta[^>]+content="([^">]+)"[^>]+property="og:image"/) ||
                       html.match(/<meta[^>]+name="twitter:image"[^>]+content="([^">]+)"/);

    if (ogImageMatch && ogImageMatch[1]) {
      return NextResponse.json({ image: ogImageMatch[1] });
    }

    return NextResponse.json({ image: null });
  } catch (error) {
    console.error('OGP Fetch Error:', error);
    return NextResponse.json({ error: 'Failed to fetch OGP' }, { status: 500 });
  }
}
