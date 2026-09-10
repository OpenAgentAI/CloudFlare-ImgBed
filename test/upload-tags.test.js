import assert from 'node:assert/strict';
import { parseUploadTags } from '../functions/utils/uploadTags.js';
import { matchesTags } from '../functions/utils/tagHelpers.js';

describe('upload tags', () => {
    it('normalizes query parameters and direct-upload JSON arrays consistently', () => {
        const expected = ['旅行', '风景', 'photo'];
        assert.deepEqual(parseUploadTags('旅行 风景，PHOTO,photo'), expected);
        assert.deepEqual(parseUploadTags(['旅行', '风景', ' PHOTO ', 'photo']), expected);
    });
    it('preserves untagged uploads and rejects malformed tags without silently dropping them', () => {
        for (const value of [undefined, null, '', '  ,，', []]) assert.deepEqual(parseUploadTags(value), []);
        for (const value of [{}, 1, ['ok', 1], 'bad/tag', [''], ['two words']]) {
            assert.throws(() => parseUploadTags(value), /Invalid tags/);
        }
    });
    it('requires every requested tag and matches without case sensitivity', () => {
        assert.equal(matchesTags(['旅行', 'PHOTO'], ['旅行', 'photo']), true);
        assert.equal(matchesTags(['旅行'], ['旅行', 'photo']), false);
    });
});
