import '../deploy/server/register.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let upload, commitUpload, list, getDatabase, HuggingFaceAPI, SqliteD1;
before(async () => {
    ({ onRequest: upload } = await import('../functions/upload/index.js'));
    ({ onRequestPost: commitUpload } = await import('../functions/upload/huggingface/commitUpload.js'));
    ({ onRequest: list } = await import('../functions/api/manage/list.js'));
    ({ getDatabase } = await import('../functions/utils/databaseAdapter.js'));
    ({ HuggingFaceAPI } = await import('../functions/utils/storage/huggingfaceAPI.js'));
    ({ SqliteD1 } = await import('../deploy/server/sqliteD1.js'));
});

function memoryKV() {
    const records = new Map();
    return {
        async put(key, value, options = {}) { records.set(key, { value, metadata: structuredClone(options.metadata || null) }); },
        async get(key) { return records.get(key)?.value ?? null; },
        async getWithMetadata(key) { return structuredClone(records.get(key) || { value: null, metadata: null }); },
        async delete(key) { records.delete(key); },
        async list({ prefix = '' } = {}) {
            return { keys: [...records].filter(([key]) => key.startsWith(prefix)).map(([name, record]) => ({ name, metadata: record.metadata })), list_complete: true };
        }
    };
}

for (const storage of ['KV', 'D1']) {
    describe(`tagged upload integration (${storage})`, () => {
        let env, db, sqlite, originalCommit, r2Writes;
        beforeEach(async () => {
            r2Writes = 0;
            env = { dev_mode: 'true', img_r2: {
                async put() { r2Writes++; },
                resumeMultipartUpload() { return { async complete(parts) { assert.equal(parts.length, 1); } }; }
            } };
            if (storage === 'KV') env.img_url = memoryKV();
            else {
                sqlite = new SqliteD1(':memory:');
                sqlite.exec(readFileSync(new URL('../database/init.sql', import.meta.url), 'utf8'));
                env.img_d1 = sqlite;
            }
            db = getDatabase(env);
            await db.put('manage@index@meta', JSON.stringify({ chunkCount: 1, totalCount: 0, lastUpdated: Date.now() }));
            await db.put('manage@index_0', '[]');
            originalCommit = HuggingFaceAPI.prototype.commitLfsFile;
        });
        afterEach(() => {
            HuggingFaceAPI.prototype.commitLfsFile = originalCommit;
            sqlite?.db.close();
        });

        async function invoke(handler, path, body, json = false) {
            const pending = [];
            const request = new Request(`https://imgbed.test${path}`, body ? {
                method: 'POST', body: json ? JSON.stringify(body) : body,
                ...(json ? { headers: { 'Content-Type': 'application/json' } } : {})
            } : {});
            const response = await handler({ env, request, waitUntil: promise => pending.push(promise) });
            await Promise.all(pending);
            return response;
        }

        async function uploadFile(name, tags) {
            const body = new FormData();
            body.set('file', new File(['test upload'], name, { type: 'text/plain' }));
            const response = await invoke(upload, `/upload?uploadChannel=cfr2&uploadNameType=origin&uploadFolder=album${tags == null ? '' : `&tags=${encodeURIComponent(tags)}`}`, body);
            assert.equal(response.status, 200, await response.clone().text());
            return (await response.json())[0].src.slice('/file/'.length);
        }

        it('saves tags with the file and searches all included/excluded tags through the list API', async () => {
            const both = await uploadFile('both.txt', '旅行，PHOTO,photo');
            await uploadFile('one.txt', '旅行');
            const plain = await uploadFile('plain.txt');
            assert.deepEqual((await db.getWithMetadata(both)).metadata.Tags, ['旅行', 'photo']);
            assert.deepEqual((await db.getWithMetadata(plain)).metadata.Tags, []);
            const response = await invoke(list, '/api/manage/list?recursive=true&includeTags=' + encodeURIComponent('旅行,photo'));
            const result = await response.json();
            assert.equal(result.isIndexedResponse, true);
            assert.equal(result.files.length, 1);
            assert.deepEqual(result.files[0].metadata.Tags, ['旅行', 'photo']);
            const excluded = await invoke(list, '/api/manage/list?recursive=true&includeTags=' + encodeURIComponent('旅行,photo') + '&excludeTags=photo');
            assert.equal((await excluded.json()).files.length, 0);
        });

        it('rejects invalid tags before writing a file', async () => {
            const body = new FormData();
            body.set('file', new File(['test'], 'bad.txt'));
            const response = await invoke(upload, '/upload?uploadChannel=cfr2&tags=bad%2Ftag', body);
            assert.equal(response.status, 400);
            assert.equal(r2Writes, 0);
        });

        it('persists tags when merging R2 chunks', async () => {
            await db.put('upload_session_test', JSON.stringify({ originalFileName: 'chunk.txt', totalChunks: 1, expiresAt: Date.now() + 60000, uploadChannel: 'cfr2' }));
            await db.put('multipart_test', JSON.stringify({ key: 'album/chunk.txt', uploadId: 'r2-test' }));
            await db.put('chunk_test_000', '', { metadata: { status: 'completed', uploadResult: { etag: 'test', partNumber: 1, size: 12 } } });
            const body = new FormData();
            for (const [key, value] of Object.entries({ uploadId: 'test', totalChunks: '1', originalFileName: 'chunk.txt', originalFileType: 'text/plain' })) body.set(key, value);
            const response = await invoke(upload, '/upload?uploadChannel=cfr2&chunked=true&merge=true&uploadFolder=album&tags=travel,photo', body);
            assert.equal(response.status, 200, await response.clone().text());
            assert.deepEqual((await db.getWithMetadata('album/chunk.txt')).metadata.Tags, ['travel', 'photo']);
        });

        it('persists tags on direct HuggingFace commit and validates before remote commit', async () => {
            let commits = 0;
            HuggingFaceAPI.prototype.commitLfsFile = async () => { commits++; return { success: true }; };
            await db.put('manage@sysConfig@upload', JSON.stringify({ huggingface: { channels: [{ name: 'test', token: 'test', repo: 'test/test', enabled: true, isPrivate: true }] } }));
            const body = { fullId: 'album/hf.txt', filePath: 'album/hf.txt', sha256: 'test', fileSize: 12, fileName: 'hf.txt', fileType: 'text/plain', tags: ['Travel', 'photo', 'travel'] };
            const response = await invoke(commitUpload, '/upload/huggingface/commitUpload', body, true);
            assert.equal(response.status, 200, await response.clone().text());
            assert.deepEqual((await db.getWithMetadata(body.fullId)).metadata.Tags, ['travel', 'photo']);
            const invalid = await invoke(commitUpload, '/upload/huggingface/commitUpload', { ...body, tags: ['bad/tag'] }, true);
            assert.equal(invalid.status, 400);
            assert.equal(commits, 1);
        });
    });
}
