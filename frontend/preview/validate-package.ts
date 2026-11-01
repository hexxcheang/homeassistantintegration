import type { HomePackage } from '../src/types.ts';

/** The same checks as the integration's `parse_package`, short of anything the preview does not need. */
export type PackageReason =
  | 'invalid_json'
  | 'wrong_format'
  | 'unsupported_version'
  | 'too_large'
  | 'missing_image';

const MESSAGES: Record<PackageReason, string> = {
  invalid_json:
    "This file isn't valid JSON. Choose the home file you downloaded from the Maxsen Planner (it ends in home.json).",
  wrong_format:
    "This isn't a Maxsen home file. Choose the home file you downloaded from the Maxsen Planner (it ends in home.json).",
  unsupported_version:
    "This home file is from a newer Maxsen Planner than this preview understands. Update the integration and this preview.",
  too_large: 'This file is larger than 100 MB, which is more than a home file should ever be.',
  missing_image:
    'This home file is missing a floor plan picture. Download it from the Maxsen Planner again.',
};

export const MAX_PACKAGE_BYTES = 100 * 1024 * 1024;
const MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const IMAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** A file that is not a usable home package; `message` is fit to show to the person who chose it. */
export class PackageProblem extends Error {
  readonly reason: PackageReason;

  constructor(reason: PackageReason) {
    super(MESSAGES[reason]);
    this.name = 'PackageProblem';
    this.reason = reason;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';

function check(condition: boolean): asserts condition {
  if (!condition) throw new PackageProblem('wrong_format');
}

function isBase64(data: string): boolean {
  try {
    atob(data);
    return true;
  } catch {
    return false;
  }
}

/** Parse and check a home file's text. Throws `PackageProblem` with a friendly message. */
export function parseHomeFile(raw: string, byteLength: number = raw.length): HomePackage {
  if (byteLength > MAX_PACKAGE_BYTES) throw new PackageProblem('too_large');
  let pkg: unknown;
  try {
    pkg = JSON.parse(raw);
  } catch {
    throw new PackageProblem('invalid_json');
  }
  if (!isRecord(pkg) || pkg['format'] !== 'maxsen-home') throw new PackageProblem('wrong_format');
  if (pkg['schemaVersion'] !== 1) throw new PackageProblem('unsupported_version');

  const project = pkg['project'];
  check(isRecord(project) && isString(project['id']) && isString(project['title']));
  const images = pkg['images'];
  check(isRecord(images));
  for (const [id, image] of Object.entries(images)) {
    check(IMAGE_ID.test(id) && isRecord(image));
    check(isString(image['mediaType']) && MEDIA_TYPES.has(image['mediaType']));
    check(isString(image['data']) && isBase64(image['data']));
  }
  const levels = pkg['levels'];
  check(Array.isArray(levels));
  for (const level of levels) {
    check(isRecord(level) && isString(level['id']) && isString(level['name']));
    const plans = level['plans'];
    check(Array.isArray(plans));
    for (const plan of plans) {
      check(isRecord(plan) && isString(plan['id']));
      check(plan['type'] === 'smart-home' || plan['type'] === 'lighting');
      check(Number.isInteger(plan['revision']) && Array.isArray(plan['elements']));
      check(isRecord(plan['scene']) && Array.isArray(plan['scene']['items']));
      const background = plan['background'];
      check(isRecord(background) && isString(background['imageId']));
      if (!(background['imageId'] in images)) throw new PackageProblem('missing_image');
      for (const element of plan['elements']) check(isRecord(element) && isString(element['id']));
    }
  }
  return pkg as unknown as HomePackage;
}
