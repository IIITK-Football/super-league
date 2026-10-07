import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Initialize the R2 client using standard S3 configuration
const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const authHeader = req.headers.get('Authorization') || '';
    const supabase = createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} },
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { data: roleRecord } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle();
    if (!['editor', 'dictator', 'admin'].includes(roleRecord?.role)) return NextResponse.json({ error: 'Insufficient role' }, { status: 403 });

    const { filename, contentType } = await req.json();

    if (!filename || !contentType) {
      return NextResponse.json({ error: "Filename and content type are required" }, { status: 400 });
    }

    // Create a unique filename so old images aren't accidentally overwritten
    const uniqueFilename = `${Date.now()}-${filename.replace(/\s+/g, '-')}`;

    // Prepare the command for Cloudflare R2
    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: uniqueFilename,
      ContentType: contentType,
    });

    // Generate a secure URL that expires in 60 seconds
    const signedUrl = await getSignedUrl(r2Client, command, { expiresIn: 60 });
    
    // Construct the final public URL that will be saved in Supabase
    const publicUrl = `${process.env.NEXT_PUBLIC_R2_URL}/${uniqueFilename}`;

    return NextResponse.json({ success: true, signedUrl, publicUrl });
  } catch (error) {
    console.error("Presigned URL error:", error);
    return NextResponse.json({ success: false, error: "Failed to generate upload URL" }, { status: 500 });
  }
}