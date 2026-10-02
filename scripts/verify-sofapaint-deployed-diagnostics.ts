import { readFile, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

const [credentialFile, outputFile] = process.argv.slice(2);
if (!credentialFile || !outputFile)
  throw new Error('Supply private draft-credential input and a new results file.');
const credentials = JSON.parse(await readFile(credentialFile, 'utf8')) as Array<{
  caseId: string;
  projectId: string;
  projectToken: string;
}>;
const client = new Client({ name: 'sofapaint-cached-mask-deployment-check', version: '1' });
const results: Record<string, unknown> = {
  status: 'running',
  startedAt: new Date().toISOString(),
  claimsPhysicalAccuracy: false,
};
const photos: Record<string, unknown>[] = [];
results.photos = photos;
try {
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL('https://sofapaint-mcp.sofapaint-api.workers.dev/public/mcp')
    )
  );
  const tools = await client.listTools();
  const checker = tools.tools.find(tool => tool.name === 'check_measurement_drawing');
  if (
    !checker?.description?.includes('cached exact mask bitmaps') ||
    checker.annotations?.readOnlyHint !== true
  )
    throw new Error('New advisory checker metadata is not deployed.');
  results.checkerMetadataVerified = true;
  for (const access of credentials) {
    const project = CallToolResultSchema.parse(
      await client.callTool({
        name: 'get_measurement_project',
        arguments: {
          projectId: access.projectId,
          projectToken: access.projectToken,
        },
      })
    );
    if (project.isError)
      throw new Error('Previously verified private draft is unavailable; no replacement created.');
    const draft = project.structuredContent as {
      images: Array<{ id: string; width: number; height: number }>;
    };
    for (const image of draft.images) {
      await new Promise(resolve => setTimeout(resolve, 1600));
      const response = CallToolResultSchema.parse(
        await client.callTool(
          {
            name: 'segment_project_image',
            arguments: {
              projectId: access.projectId,
              projectToken: access.projectToken,
              imageId: image.id,
            },
          },
          undefined,
          { timeout: 90000 }
        )
      );
      if (response.isError) throw new Error('Hosted cached-mask verification failed.');
      const evidence = response.structuredContent as {
        image: { width: number; height: number; sha256: string };
        model: { sha256: string };
      };
      if (
        evidence.image.width !== image.width ||
        evidence.image.height !== image.height ||
        evidence.model.sha256 !== 'd8b3be861b6abcf0d9656d77432aa23b22b2d3f8f4037061fa41d7ef95658dc1'
      )
        throw new Error('Hosted photo frame or production model mismatch.');
      photos.push({
        caseId: access.caseId,
        imageId: image.id,
        photo: evidence.image,
        modelSha256: evidence.model.sha256,
      });
    }
  }
  results.status = 'completed';
  results.limitations =
    'Verifies deployed metadata and cached segmentation reads. Does not exercise path diagnostics on a live drawing or prove measurement accuracy.';
} catch (error) {
  results.status = 'failed';
  results.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await client.close();
  results.completedAt = new Date().toISOString();
  await writeFile(outputFile, JSON.stringify(results, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(
    JSON.stringify({ status: results.status, photos: photos.length, error: results.error })
  );
}
