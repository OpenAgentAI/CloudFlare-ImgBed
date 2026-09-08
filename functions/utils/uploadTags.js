import { normalizeTags, validateTag } from './tagHelpers.js';

// Shared by regular uploads, chunk merges and direct HuggingFace commits.
export function parseUploadTags(value) {
    if (value == null || value === '') return [];
    const tags = typeof value === 'string' ? value.split(/[\s,，]+/).filter(Boolean) : value;
    if (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string' || !validateTag(tag.trim()))) {
        throw new Error('Invalid tags: use letters, numbers, CJK characters, underscores or hyphens');
    }
    return normalizeTags(tags);
}
