// MIT. Transport-independent Studio MCP tool definitions.
// Callers must supply an authenticated, project-scoped dispatcher that checks
// the current grant on every call.
import { createMcpHandler, McpServer, createRequestStateCodec, inputRequired, acceptedContent } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';
import { sha256Hex } from '../lib/util.mjs';

const id = z.string().regex(/^[a-z0-9_]{1,80}$/);
const noArgs = z.object({}).strict();
const projectArg = z.object({ projectId: id }).strict();
const assetArg = z.object({ assetId: id }).strict();
const generationArg = z.object({ generationId: id }).strict();

/** The dispatcher must apply current authorization and project scope on every
 * call, and may address only this installation's existing /api routes. No
 * browser cookie, passphrase or provider key is accepted by these tools. */
export function createStudioMcpHandler(dispatch, options = {}) {
  if (typeof dispatch !== 'function') throw new TypeError('An authorized Studio dispatcher is required');
  const codec = options.quote && options.stateKey && options.binding ? createRequestStateCodec({ key: options.stateKey, ttlSeconds: 300 }) : null;
  return createMcpHandler(() => {
    const server = new McpServer({ name: 'media-studio', version: '0.1.0' }, codec ? { requestState: { verify: codec.verify } } : undefined);
    const register = (name, description, inputSchema, path, { readOnly = true, destructive = false, openWorld = false, method = 'GET', payload } = {}) => {
      server.registerTool(name, {
        description,
        inputSchema,
        annotations: { readOnlyHint: readOnly, destructiveHint: destructive, openWorldHint: openWorld },
      }, async (input) => {
        try {
          const result = await dispatch({ method, path: path(input), body: payload?.(input) });
          if (!result || typeof result !== 'object' || !Number.isInteger(result.status)) throw new Error('Invalid dispatcher response');
          if (result.status < 200 || result.status >= 300) {
            const error = result.body?.error;
            return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code: error?.code ?? 'studio_error', message: error?.message ?? 'Studio request failed', status: result.status } }) }] };
          }
          return { content: [{ type: 'text', text: JSON.stringify(result.body) }], structuredContent: result.body };
        } catch {
          return { isError: true, content: [{ type: 'text', text: 'Studio request failed. Check the project and try again.' }] };
        }
      });
    };
    register('studio_list_projects', 'List projects and available recipes within the current grant.', noArgs, () => '/api/state');
    register('studio_list_models', 'List configured creative models and availability; this does not start generation.', noArgs, () => '/api/models');
    register('studio_get_project', 'Inspect a granted project, including saved assets, jobs, recipes, publications, storyboards and budget.', projectArg, ({ projectId }) => `/api/projects/${projectId}`);
    register('studio_get_asset', 'Inspect a saved asset in the current project.', assetArg, ({ assetId }) => `/api/assets/${assetId}`);
    register('studio_get_job', 'Read the last saved job state and budget without polling or advancing any provider job.', generationArg, ({ generationId }) => `/api/generations/${generationId}`);
    register('studio_export_project', 'Read the project export, including asset and job records; media bytes download separately.', projectArg, ({ projectId }) => `/api/projects/${projectId}/export`);
    const download = z.object({ assetId: id, offset: z.number().int().min(0), length: z.number().int().min(1).max(49152).default(49152) }).strict();
    server.registerTool('studio_download_asset_chunk', { description: 'Read one bounded base64-encoded chunk of an owned asset. Repeat with the next offset to download the full file; original bytes and metadata stay in Studio.', inputSchema: download, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }, async ({ assetId, offset, length }) => {
      try {
        const result = await dispatch({ method: 'GET', path: `/api/assets/${assetId}/download`, binaryRange: { offset, length } });
        if (result.status !== 206) return { isError: true, content: [{ type: 'text', text: JSON.stringify(result.body) }] };
        return { content: [{ type: 'text', text: JSON.stringify(result.body) }], structuredContent: result.body };
      } catch { return { isError: true, content: [{ type: 'text', text: 'The asset chunk could not be read.' }] }; }
    });
    const reference = z.object({ id: z.string().max(60).optional(), title: z.string().min(1).max(100), url: z.string().max(2048), note: z.string().max(240).optional() }).strict();
    const projectUpdate = z.object({ projectId: id, name: z.string().min(1).max(80).optional(), creativeDirection: z.string().max(600).optional(), references: z.array(reference).max(12).optional() }).strict();
    register('studio_update_project', 'Update the project name, direction or entire reference list. Providing references replaces the current list; inspect it first.', projectUpdate, ({ projectId }) => `/api/projects/${projectId}`, { readOnly: false, method: 'PATCH', payload: ({ projectId, ...body }) => body });
    const importArg = z.object({ projectId: id, assetId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,127}$/), reuseConfirmed: z.literal(true) }).strict();
    register('studio_import_share_artwork', 'Import one Woodhouse Share original into this project after confirming reuse rights; preserves source and credit.', importArg, ({ projectId }) => `/api/projects/${projectId}/assets/woodhouse`, { readOnly: false, openWorld: true, method: 'POST', payload: ({ assetId, reuseConfirmed }) => ({ assetId, reuseConfirmed }) });
    register('studio_list_song_plans', 'Read this project’s saved song-scene plans and revisions. No generation or spend.', projectArg, ({ projectId }) => `/api/projects/${projectId}/song-plans`);
    const planCreate = z.object({ projectId: id, songAssetId: id, rightsConfirmed: z.literal(true), title: z.string().min(1).max(80), treatment: z.string().max(1200).optional(), aspect: z.enum(['16:9', '9:16', '1:1']), startMs: z.number().int().min(0), endMs: z.number().int().min(1), sceneCount: z.number().int().min(2).max(6) }).strict();
    register('studio_create_song_plan', 'Save a proposed 2–60 second song segment with evenly suggested scene boundaries. No clips are generated and no charge occurs.', planCreate, ({ projectId }) => `/api/projects/${projectId}/song-plans`, { readOnly: false, method: 'POST', payload: ({ projectId, ...body }) => body });
    const planScene = z.object({ id, startMs: z.number().int().min(0), endMs: z.number().int().min(1), direction: z.string().max(1200), referenceAssetId: id.nullable(), selectedTakeId: id.nullable() }).strict();
    const planUpdate = z.object({ projectId: id, planId: id, expectedRevision: z.number().int().min(1), title: z.string().min(1).max(80), treatment: z.string().max(1200).optional(), aspect: z.enum(['16:9', '9:16', '1:1']), startMs: z.number().int().min(0), endMs: z.number().int().min(1), scenes: z.array(planScene).min(2).max(6) }).strict();
    register('studio_update_song_plan', 'Replace the reviewed timeline at its last-read revision; stale edits are refused. No generation or spend.', planUpdate, ({ projectId, planId }) => `/api/projects/${projectId}/song-plans/${planId}`, { readOnly: false, method: 'PATCH', payload: ({ projectId, planId, ...body }) => body });
    const captionCue = z.object({ id, startMs: z.number().int().min(0), endMs: z.number().int().min(1), text: z.string().min(1).max(300), speaker: z.string().max(80).optional() }).strict();
    const captionsUpdate = z.object({ projectId: id, planId: id, expectedRevision: z.number().int().min(1), rightsConfirmed: z.literal(true), cues: z.array(captionCue).max(100) }).strict();
    register('studio_update_song_captions', 'Save owner-supplied, manually timed captions against the plan revision. No transcription or paid call is made.', captionsUpdate, ({ projectId, planId }) => `/api/projects/${projectId}/song-plans/${planId}/captions`, { readOnly: false, method: 'PATCH', payload: ({ projectId, planId, ...body }) => body });
    const captionExport = z.object({ projectId: id, planId: id, format: z.enum(['srt', 'vtt']) }).strict();
    register('studio_export_song_captions', 'Export the saved caption sidecar, timed relative to the chosen segment; does not render video.', captionExport, ({ projectId, planId, format }) => `/api/projects/${projectId}/song-plans/${planId}/captions?format=${format}`);
    register('studio_list_footage_plans', 'Read saved cut maps for this project; no processing or spend.', projectArg, ({ projectId }) => `/api/projects/${projectId}/footage-plans`);
    const footageCreate = z.object({ projectId: id, sourceAssetId: id, rightsConfirmed: z.literal(true), title: z.string().min(1).max(80), treatment: z.string().max(1200).optional(), aspect: z.enum(['16:9', '9:16', '1:1']), sourceStartMs: z.number().int().min(0), sourceEndMs: z.number().int().min(1), sceneCount: z.number().int().min(1).max(6) }).strict();
    register('studio_create_footage_plan', 'Save evenly suggested source-video ranges as a cut map; this does not detect cuts, transform or render footage.', footageCreate, ({ projectId }) => `/api/projects/${projectId}/footage-plans`, { readOnly: false, method: 'POST', payload: ({ projectId, ...body }) => body });
    const footageScene = z.object({ id, sourceStartMs: z.number().int().min(0), sourceEndMs: z.number().int().min(1), direction: z.string().max(1200), referenceAssetId: id.nullable(), selectedTakeId: id.nullable() }).strict();
    const footageUpdate = z.object({ projectId: id, planId: id, expectedRevision: z.number().int().min(1), title: z.string().min(1).max(80), treatment: z.string().max(1200).optional(), aspect: z.enum(['16:9', '9:16', '1:1']), scenes: z.array(footageScene).min(1).max(6) }).strict();
    register('studio_update_footage_plan', 'Save source ranges and selected takes at the last-read revision; stale edits are refused, without generation or spend.', footageUpdate, ({ projectId, planId }) => `/api/projects/${projectId}/footage-plans/${planId}`, { readOnly: false, method: 'PATCH', payload: ({ projectId, planId, ...body }) => body });
    const songStoryboard = z.object({ projectId: id, planId: id, expectedRevision: z.number().int().min(1), allowTrim: z.boolean().optional() }).strict();
    register('studio_storyboard_from_song_plan', 'Save or reopen a storyboard from selected takes and the song segment. Set allowTrim only after approving use of the beginning of longer takes. No mix, render or charge occurs.', songStoryboard, ({ projectId, planId }) => `/api/projects/${projectId}/song-plans/${planId}/storyboard`, { readOnly: false, method: 'POST', payload: ({ expectedRevision, allowTrim }) => ({ expectedRevision, allowTrim }) });
    const shot = z.object({ assetId: id, trimStartMs: z.number().int().min(0).optional(), trimEndMs: z.number().int().min(1).optional() }).strict();
    const audioTrack = z.object({ assetId: id, role: z.enum(['music','voice','effect']), startMs: z.number().int().min(0).optional(), trimStartMs: z.number().int().min(0).optional(), trimEndMs: z.number().int().min(0).optional(), gainDb: z.number().min(-24).max(12).optional(), fadeInMs: z.number().int().min(0).max(3000).optional(), fadeOutMs: z.number().int().min(0).max(3000).optional() }).strict();
    const compositionFields = { title: z.string().min(1).max(80), shots: z.array(shot).min(2).max(6), audioAssetId: id.optional(), audioTracks: z.array(audioTrack).max(4).optional(), slateAssetId: id.optional(), slateVideoAssetId: id.optional() };
    const composition = z.object({ projectId: id, ...compositionFields }).strict();
    register('studio_create_storyboard', 'Save a storyboard from two to six existing project clips; does not render or incur inference charges.', composition, ({ projectId }) => `/api/projects/${projectId}/compositions`, { readOnly: false, method: 'POST', payload: ({ projectId, ...body }) => body });
    const compositionUpdate = z.object({ projectId: id, compositionId: id, expectedUpdatedAt: z.number().int().min(0).optional(), ...compositionFields }).strict();
    register('studio_update_storyboard', 'Replace a saved storyboard manifest. Existing rendered results remain attached; this does not render.', compositionUpdate, ({ projectId, compositionId }) => `/api/projects/${projectId}/compositions/${compositionId}`, { readOnly: false, method: 'PATCH', payload: ({ projectId, compositionId, ...body }) => body });
    const rename = z.object({ assetId: id, title: z.string().min(1).max(100), caption: z.string().max(400).optional() }).strict();
    register('studio_rename_asset', 'Update a saved asset title and optional caption.', rename, ({ assetId }) => `/api/assets/${assetId}`, { readOnly: false, method: 'PATCH', payload: ({ assetId, ...body }) => body });
    const publish = z.object({ assetId: id, title: z.string().min(1).max(100), description: z.string().max(300).optional(), posterAssetId: id.optional() }).strict();
    register('studio_publish_asset', 'Publish an asset under the standing publication authority granted to this connection. The title, description and media become public.', publish, ({ assetId }) => `/api/assets/${assetId}/publish`, { readOnly: false, openWorld: true, method: 'POST', payload: ({ assetId, ...body }) => body });
    const withdraw = z.object({ publicationId: id }).strict();
    register('studio_withdraw_publication', 'Withdraw a public page under the standing publication authority granted to this connection. Copies already downloaded cannot be recalled.', withdraw, ({ publicationId }) => `/api/publications/${publicationId}`, { readOnly: false, destructive: true, openWorld: true, method: 'DELETE' });
    if (codec) {
      const generation = z.object({ projectId: id, kind: z.enum(['image','video','audio']), model: z.string().min(1).max(80), prompt: z.string().max(1800), aspect: z.string().max(40).optional(), durationSeconds: z.number().int().min(1).max(300).optional(), recipeId: z.string().max(80).optional(), referenceAssetId: id.optional(), maskAssetId: id.optional(), parentAssetId: id.optional(), clientRequestId: z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/), maxCostMicro: z.number().int().min(0).max(100000000) }).strict();
      const approval = z.object({ approve: z.boolean().meta({ title: 'Approve this estimated charge' }) });
      server.registerTool('studio_generate', { description: 'Generate under the owner-set spending limit for this connection. Shows an estimated charge using client elicitation and requires a stable clientRequestId; unsupported clients cannot dispatch.', inputSchema: generation, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: true } }, async (input, ctx) => {
        try {
          const { projectId, maxCostMicro, ...body } = input;
          const quote = await options.quote({ projectId, body, maxCostMicro });
          const fingerprint = await sha256Hex(new TextEncoder().encode(JSON.stringify({ projectId, body, maxCostMicro, costMicro: quote.costMicro, binding: options.binding })));
          const state = ctx.mcpReq.requestState();
          if (!state) return inputRequired({ inputRequests: { consent: inputRequired.elicit({ message: `Create one ${body.kind} with ${quote.modelLabel} in ${quote.projectName}? Estimated US$${(quote.costMicro / 1000000).toFixed(4)}; the provider may charge. ${body.prompt ? `Direction: ${body.prompt.slice(0, 300)}` : ''}`, requestedSchema: approval }) }, requestState: await codec.mint({ fingerprint }) });
          if (state.fingerprint !== fingerprint || acceptedContent(ctx.mcpReq.inputResponses, 'consent', approval)?.approve !== true)
            return { isError: true, content: [{ type: 'text', text: 'Generation was not confirmed. Nothing was submitted.' }] };
          const result = await dispatch({ method: 'POST', path: `/api/projects/${projectId}/generations`, body, spend: { maxCostMicro, quotedCostMicro: quote.costMicro } });
          if (result.status < 200 || result.status >= 300) return { isError: true, content: [{ type: 'text', text: JSON.stringify(result.body) }] };
          return { content: [{ type: 'text', text: JSON.stringify(result.body) }], structuredContent: result.body };
        } catch (error) {
          return { isError: true, content: [{ type: 'text', text: error?.publicMessage || 'Generation could not be prepared. Nothing was submitted by this call.' }] };
        }
      });
    }
    return server;
  }, { legacy: 'stateless' });
}
