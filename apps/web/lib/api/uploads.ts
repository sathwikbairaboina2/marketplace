import { UploadedImageSchema } from '@marketplace/contracts';
import { ENGINE_URL } from '../env';
import { getToken } from '../auth/auth-context';
import { ContractMismatchError, ProblemError, type ProblemField } from './http';

/**
 * Posts an image to the engine, which validates it and writes it to S3.
 *
 * This does not go through `request()` because the body is `FormData`, not
 * JSON: `request()` sets `Content-Type: application/json` and stringifies, both
 * of which would break a multipart upload. The error handling below is
 * deliberately identical, so a failure here surfaces exactly like any other.
 */
export async function uploadProductImage(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);

  const headers = new Headers();
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  // No Content-Type: fetch has to set it, because only fetch knows the
  // multipart boundary it generated.

  const res = await fetch(`${ENGINE_URL}/uploads/product-image`, {
    method: 'POST',
    headers,
    body: form,
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new ProblemError(
      typeof body.type === 'string' ? body.type : 'about:blank',
      res.status,
      typeof body.title === 'string' ? body.title : res.statusText,
      typeof body.detail === 'string' ? body.detail : undefined,
      typeof body.traceId === 'string' ? body.traceId : undefined,
      Array.isArray(body.errors) ? (body.errors as ProblemField[]) : [],
    );
  }

  const parsed = UploadedImageSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new ContractMismatchError('/uploads/product-image', parsed.error.issues);
  }
  return parsed.data.objectUrl;
}
