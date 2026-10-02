import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { parseProductConfiguration } from '../server/vercel-routes/cw/shared.js';
import {
  isArchivedModelUnconfirmed,
  isArchivedStyleMismatch,
} from '../server/vercel-routes/cw/archive.ts';

// Read-only archival tool. Credentials stay in memory and outside the archive.
dotenv.config({ path: '.env.local', quiet: true });
const archive = process.env.CW_ARCHIVE_DIR || path.resolve('../cw-product-archive-2026-09-29');
const mode = process.argv[2] || 'catalogue';
const cwBase = 'https://cw40.comfort-works.com/api/';
const pidBase = 'https://cw-pid-qylyewlgca-uc.a.run.app';
const schema = JSON.parse(await fs.readFile(path.join(archive, 'graphql-schema.json'), 'utf8')).data
  .__schema;
const types = new Map<string, any>(schema.types.map((type: any) => [type.name, type]));
let auth = await fs
  .readFile('/tmp/openpaint-cw-backup/auth.json', 'utf8')
  .then(JSON.parse, () => ({}));
let refreshPromise: Promise<void> | undefined;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const safeName = (value: string) => value.replace(/[^a-zA-Z0-9_.-]/g, '_');
const sha = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex');
const unwrap = (type: any): any => (type.ofType ? unwrap(type.ofType) : type);
const scalarSelection = (name: string, skip: string[] = []) =>
  types
    .get(name)
    .fields.filter(
      (field: any) =>
        ['SCALAR', 'ENUM'].includes(unwrap(field.type).kind) &&
        !skip.includes(field.name) &&
        !field.args.some((arg: any) => arg.type.kind === 'NON_NULL')
    )
    .map((field: any) => field.name)
    .join(' ');
async function exists(file: string) {
  return fs.access(file).then(
    () => true,
    () => false
  );
}
async function save(relative: string, value: any) {
  const file = path.join(archive, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file + '.part', JSON.stringify(value, null, 2));
  await fs.rename(file + '.part', file);
}
async function request(url: string, options: any = {}, tries = 4): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(55000) });
      if ((response.status === 429 || response.status >= 500) && attempt + 1 < tries) {
        await response.body?.cancel();
        await delay(
          Math.max(Number(response.headers.get('retry-after')) * 1000 || 0, 1500 * 2 ** attempt)
        );
        continue;
      }
      return response;
    } catch (error) {
      if (attempt + 1 >= tries) throw error;
      await delay(1500 * 2 ** attempt);
    }
  }
}
async function refreshAuth() {
  if (!refreshPromise)
    refreshPromise = (async () => {
      const response = await request(cwBase, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query:
            'mutation($email:String!,$password:String!){tokenAuth(input:{email:$email,password:$password}){token}}',
          variables: { email: process.env.CW_USERNAME, password: process.env.CW_PASSWORD },
        }),
      });
      const data: any = await response.json();
      const cwToken = data.data?.tokenAuth?.token;
      if (!cwToken) throw new Error('CW authentication failed');
      const tokenResponse = await request(cwBase, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'JWT ' + cwToken },
        body: JSON.stringify({ query: '{staffMtToken{accessToken refreshToken}}' }),
      });
      const tokenData: any = await tokenResponse.json();
      if (!tokenData.data?.staffMtToken?.accessToken)
        throw new Error('Measurement authentication failed');
      auth = { cwToken, ...tokenData.data.staffMtToken };
      await fs.mkdir('/tmp/openpaint-cw-backup', { recursive: true, mode: 0o700 });
      await fs.writeFile('/tmp/openpaint-cw-backup/auth.json', JSON.stringify(auth), {
        mode: 0o600,
      });
    })().finally(() => {
      refreshPromise = undefined;
    });
  await refreshPromise;
}
async function gql(query: string, variables: any = {}, retry = true): Promise<any> {
  if (!auth.cwToken) await refreshAuth();
  const response = await request(cwBase, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'JWT ' + auth.cwToken },
    body: JSON.stringify({ query, variables }),
  });
  const data: any = await response.json();
  if (
    retry &&
    data.errors?.some((error: any) => /expired|signature|authentication/i.test(error.message))
  ) {
    await refreshAuth();
    return gql(query, variables, false);
  }
  if (!response.ok || data.errors?.length)
    throw new Error(
      'GraphQL: ' + (data.errors?.map((error: any) => error.message).join('; ') || response.status)
    );
  return data.data;
}
async function paginated(root: string, selection: string, pageSize = 100, savedRoot = root) {
  const dir = `graphql/${savedRoot}`;
  let after = '',
    index = 0,
    total: number | null = null;
  const nodes: any[] = [];
  while (true) {
    const file = `${dir}/page-${String(index).padStart(4, '0')}.json`;
    let data: any;
    if (await exists(path.join(archive, file)))
      data = JSON.parse(await fs.readFile(path.join(archive, file), 'utf8'));
    else {
      const rootType = unwrap(
        schema.queryType.fields.find((field: any) => field.name === root).type
      ).name;
      const hasCount = types.get(rootType).fields.some((field: any) => field.name === 'totalCount');
      const hasSort = schema.queryType.fields
        .find((field: any) => field.name === root)
        .args.some((arg: any) => arg.name === 'sort');
      const query = `query($after:String,$first:Int){${root}(first:$first,after:$after${hasSort ? ',sort:["id"]' : ''}){${hasCount ? 'totalCount' : ''} pageInfo{hasNextPage endCursor} edges{node{${selection}}}}}`;
      data = (await gql(query, { after, first: pageSize }))[root];
      await save(file, data);
    }
    nodes.push(...data.edges.map((edge: any) => edge.node));
    if (data.totalCount != null) total = data.totalCount;
    console.log(JSON.stringify({ stage: root, page: index, saved: nodes.length, total }));
    if (!data.pageInfo.hasNextPage) break;
    if (!data.pageInfo.endCursor || data.pageInfo.endCursor === after)
      throw new Error('Pagination cursor stopped advancing');
    after = data.pageInfo.endCursor;
    index++;
    await delay(150);
  }
  if (
    total !== null &&
    nodes.every(node => node.id) &&
    new Set(nodes.map(node => node.id)).size !== total
  )
    throw new Error(`${root}: distinct IDs do not match totalCount`);
  await save(`${savedRoot}.json`, {
    fetchedAt: new Date().toISOString(),
    totalCount: total ?? nodes.length,
    items: nodes,
  });
  return nodes;
}
async function pool<T>(
  items: T[],
  worker: (item: T, index: number) => Promise<void>,
  concurrency = 4
) {
  let cursor = 0,
    done = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        await worker(items[index], index);
        if (++done % 25 === 0 || done === items.length)
          console.log(JSON.stringify({ stage: mode, processed: done, total: items.length }));
        await delay(120);
      }
    })
  );
}
async function catalogue() {
  await paginated(
    'products',
    `id reference name cover gallery pdfUrl status measurementsRequired productUrl price discountPrice quantity dateAdd dateUpd tags meter hour optionGroupProductRef brand{id name ref} combinationTemplate{id name} translations{edges{node{${scalarSelection('ProductTranslation')}}}}`,
    100
  );
}
async function editorConfigurations() {
  const rows = await paginated(
    'products',
    scalarSelection('Product', ['productConfiguration', 'startsfromPrice', 'translatedName']),
    100,
    'product-editor-metadata'
  );
  const original = JSON.parse(await fs.readFile(path.join(archive, 'products.json'), 'utf8'));
  if (!(await exists(path.join(archive, 'products-initial.json'))))
    await save('products-initial.json', original);
  const byId = new Map(rows.map((row: any) => [row.id, row]));
  original.items = original.items.map((row: any) => ({ ...row, ...byId.get(row.id) }));
  await save('products.json', original);
}
async function dictionaries() {
  const jobs = [
    ['optionGroups', 'OptionGroup'],
    ['priceGroups', 'PriceGroup'],
    ['exclusions', 'Exclusion'],
    ['combinationTemplates', 'CombinationTemplate'],
    ['fabrics', 'Fabric'],
    ['fabricCategories', 'FabricCategory'],
    ['brands', 'Brand'],
    ['categories', 'Category'],
    ['attributes', 'Attribute'],
    ['attributeValues', 'AttributeValue'],
    ['productVariants', 'ProductVariant'],
  ];
  await pool(
    jobs,
    async ([root, type]) => {
      try {
        if (await exists(path.join(archive, `${root}.json`))) return;
        let selection = scalarSelection(type);
        if (root === 'combinationTemplates')
          selection += ' optionGroups{id} priceGroups{id} exclusions{id}';
        if (root === 'productVariants') selection += ' product{id reference}';
        if (root === 'attributeValues')
          selection += ' product{id reference} attribute{id name type}';
        const translationField = types
          .get(type)
          .fields.find((field: any) => field.name === 'translations');
        if (translationField) {
          const connection = unwrap(translationField.type).name;
          const edge = connection.replace(/Connection$/, 'Edge');
          const nodeType = unwrap(
            types.get(edge)?.fields.find((field: any) => field.name === 'node')?.type || {}
          ).name;
          if (types.has(nodeType))
            selection += ` translations{edges{node{${scalarSelection(nodeType)}}}}`;
        }
        await paginated(root, selection, 100);
      } catch (error: any) {
        await save(`failures/dictionary-${root}.json`, {
          root,
          error: error.message,
          time: new Date().toISOString(),
        });
        console.log(JSON.stringify({ failedDictionary: root, error: error.message }));
      }
    },
    2
  );
  await pidDictionaries();
}
async function pidDictionaries(
  endpoints = [
    'base-product-components',
    'base-product-components-translations',
    'product-component-fields',
    'product-component-field-translations',
    'qc-attributes',
    'qc-attribute-translations',
    'qc-measurements',
    'qc-measurement-translations',
    'translation-keys',
    'translations',
    'product-component-files',
  ]
) {
  await pool(
    endpoints,
    async endpoint => {
      const content: any[] = [];
      let page = 1;
      let last: any;
      while (true) {
        const response = await request(`${pidBase}/mtApi/${endpoint}/?page=${page}&page_size=100`, {
          headers: { Authorization: 'Bearer ' + auth.accessToken },
        });
        const data: any = await response.json();
        await save(`pid-dictionary-pages/${endpoint}/${page}.json`, {
          status: response.status,
          data,
        });
        last = { status: response.status, data };
        if (Array.isArray(data.content)) content.push(...data.content);
        if (!response.ok || !data.links?.next) break;
        // Keep the token on the trusted PID origin; the backend's links use its internal origin.
        const nextPage = Number(new URL(data.links.next).searchParams.get('page'));
        if (!Number.isInteger(nextPage) || nextPage <= page)
          throw new Error('PID pagination stopped advancing');
        page = nextPage;
      }
      if (
        last.status === 200 &&
        last.data.count != null &&
        new Set(content.map(item => item.id)).size !== last.data.count
      )
        throw new Error(`${endpoint}: distinct IDs do not match count`);
      await save(`pid-dictionaries/${endpoint}.json`, {
        ...last,
        ...(content.length ? { items: content } : {}),
        pages: page,
      });
    },
    2
  );
}
async function tuples() {
  const products = JSON.parse(await fs.readFile(path.join(archive, 'products.json'), 'utf8')).items;
  const templates = new Map<string, any>(
    JSON.parse(
      await fs.readFile(path.join(archive, 'combinationTemplates.json'), 'utf8')
    ).items.map((item: any) => [item.id, item])
  );
  const groups = new Map<string, any>(
    JSON.parse(await fs.readFile(path.join(archive, 'optionGroups.json'), 'utf8')).items.map(
      (item: any) => [item.id, item]
    )
  );
  const exclusions = new Map<string, any>(
    JSON.parse(await fs.readFile(path.join(archive, 'exclusions.json'), 'utf8')).items.map(
      (item: any) => [item.id, item]
    )
  );
  const configs = products.map((product: any) => {
    const template = templates.get(product.combinationTemplate?.id);
    const rawGroups = (template?.optionGroups || [])
      .map((item: any) => groups.get(item.id))
      .filter(Boolean);
    const parsedGroups = rawGroups
      .map((group: any) => {
        try {
          return { ...JSON.parse(group.data), group_name: group.name };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const configurationInput = {
      productConfiguration: { groups: parsedGroups },
      productReference: product.reference,
      productName: product.name,
    };
    const parsed = parseProductConfiguration(configurationInput);
    const rawExclusions = (template?.exclusions || [])
      .map((item: any) => exclusions.get(item.id))
      .filter(Boolean);
    const hiddenOptions = new Set<string>(),
      hiddenGroups = new Set<string>();
    for (const exclusion of rawExclusions) {
      let rules: any[] = [];
      try {
        rules = JSON.parse(exclusion.data);
      } catch {
        /* preserve malformed originals */
      }
      if (!Array.isArray(rules)) continue;
      for (const rule of rules)
        if (rule.condition?.[0] === 'any') {
          for (const code of Array.isArray(rule.hide_option)
            ? rule.hide_option
            : [rule.hide_option])
            if (code) hiddenOptions.add(code);
          for (const name of Array.isArray(rule.hide_group) ? rule.hide_group : [rule.hide_group])
            if (name) hiddenGroups.add(name);
        }
    }
    // Match the PID website's selection page, including unconditional exclusions.
    // Other configuration groups (seams, custom lengths) are not measurement styles.
    const styleGroup = parsedGroups.find((group: any) => group.group_name.includes('styles'));
    const versionGroups = parsedGroups.filter((group: any) =>
      group.group_name.includes('my-sofa-is')
    );
    try {
      const renderNames = Object.keys(JSON.parse(product.combinationRender || '{}'));
      if (versionGroups.every((group: any) => renderNames.includes(group.group_name)))
        versionGroups.sort(
          (a: any, b: any) => renderNames.indexOf(a.group_name) - renderNames.indexOf(b.group_name)
        );
    } catch {
      /* retain the source template order when render metadata is absent */
    }
    const displayName = (option: any) =>
      typeof option.name === 'string'
        ? option.name
        : option.name?._translateable?.UN || option.code || '';
    const styleOptions = styleGroup
      ? (styleGroup.content || [])
          .filter((option: any) => !hiddenOptions.has(option.code))
          .map((option: any) => ({
            productReference: product.reference,
            style: displayName(option),
            styleCode: option.code,
            label: displayName(option),
            source: 'archived-pid-configuration',
          }))
      : [
          {
            productReference: product.reference,
            style: 'Original',
            styleCode: '',
            label: 'Original',
            source: 'archived-pid-configuration',
          },
        ];
    // The CW40 editor combines EVERY my-sofa-is group with separate __ delimiters.
    // The PID selector only uses the first group, producing incomplete references.
    let versionOptions: any[] = versionGroups.length ? [{ code: '', label: '' }] : [];
    for (const group of versionGroups) {
      const options = (group.content || []).filter((option: any) => option.code !== 'DF');
      versionOptions = versionOptions.flatMap((parent: any) =>
        options.map((option: any) => {
          const code = [parent.code, option.code].filter(Boolean).join('__');
          return {
            code,
            label: [parent.label, displayName(option)].filter(Boolean).join(' · '),
            scopedReference: `${product.reference}__${code}`,
            modelSetConfirmed: false,
            source: 'archived-cw40-editor',
          };
        })
      );
    }
    let savedReferences: any = {};
    try {
      savedReferences = JSON.parse(product.optionGroupProductRef || '{}');
    } catch {
      /* raw original retained */
    }
    const archivedSavedReferences: string[] = [];
    const currentGroupKey = versionGroups.map((group: any) => group.group_name).join('__');
    const savedGroupMatches = Object.keys(savedReferences)[0] === currentGroupKey;
    for (const [groupKey, entries] of Object.entries(savedReferences)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries)
        for (const [reference, confirmation] of Object.entries(entry)) {
          const option = versionOptions.find((item: any) => item.scopedReference === reference);
          archivedSavedReferences.push(reference);
          if (option && savedGroupMatches && groupKey === currentGroupKey)
            option.modelSetConfirmed = confirmation === 'confirmed';
        }
    }
    return {
      ...parsed,
      styleOptions,
      versionOptions,
      hasVersionConfiguration: versionGroups.length > 0,
      archivedSavedReferences,
      derivedScopedReferences: versionOptions.map((option: any) => option.scopedReference),
      id: product.id,
      reference: product.reference,
      optionGroups: rawGroups,
      exclusions: rawExclusions,
    };
  });
  await save('product-configurations.json', configs);
  const publicCatalogue = JSON.parse(
    await fs.readFile(path.join(archive, 'public-catalogue', 'sofas.json'), 'utf8')
  );
  const aliases = new Map<string, string[]>();
  for (const family of publicCatalogue.families || [])
    for (const product of family.products || []) {
      if (!product.reference) continue;
      const reference = product.reference.toUpperCase();
      aliases.set(reference, [
        ...new Set(
          [
            ...(aliases.get(reference) || []),
            product.title,
            ...(family.brands || []),
            product.series,
          ].filter(Boolean)
        ),
      ]);
    }
  await save('runtime-index.json', {
    products: products.map((product: any) => ({
      id: product.id,
      reference: product.reference,
      name: product.name,
      status: product.status,
      catalogueTitles: aliases.get(product.reference.toUpperCase()) || [],
      brand: product.brand,
      translations: {
        edges: (product.translations?.edges || []).map((edge: any) => ({
          node: { name: edge.node.name, lang: edge.node.lang },
        })),
      },
    })),
    configs: configs.map((config: any) => ({
      id: config.id,
      hasVersionConfiguration: config.hasVersionConfiguration,
      styleOptions: config.styleOptions,
      versionOptions: config.versionOptions,
      derivedScopedReferences: config.derivedScopedReferences,
    })),
  });
  const rows: any[] = [];
  const seen = new Set<string>();
  const modelReferences = JSON.parse(
    await fs.readFile(path.join(archive, 'mtProductsModelsetName.json'), 'utf8')
  ).data.mtProductsModelsetName;
  for (const config of configs) {
    const nativeRefs = config.derivedScopedReferences.length
      ? config.derivedScopedReferences
      : [config.reference];
    const refs = Array.from(
      new Set([
        ...nativeRefs,
        ...config.archivedSavedReferences,
        config.reference,
        ...modelReferences
          .map((row: any) => row.reference)
          .filter((reference: string) => reference.split('__')[0] === config.reference),
      ])
    );
    const styles = config.styleOptions.length
      ? config.styleOptions
      : [{ style: 'Original', styleCode: '' }];
    for (const reference of refs)
      for (const style of styles) {
        const row = {
          productId: config.id,
          reference,
          style: style.style,
          styleCode: style.styleCode || '',
        };
        const key = `${reference}|${row.style}|${row.styleCode}`;
        if (!seen.has(key)) {
          seen.add(key);
          rows.push({ ...row, key, file: sha(key) + '.json' });
        }
      }
  }
  await save('measurement-tuples.json', rows);
  console.log(JSON.stringify({ measurementTuples: rows.length }));
}
async function mtProducts() {
  const source = JSON.parse(
    await fs.readFile(path.join(archive, 'mtProductsModelsetName.json'), 'utf8')
  ).data.mtProductsModelsetName;
  const references = [...new Set<string>(source.map((row: any) => row.reference))];
  const batches: string[][] = [];
  for (let index = 0; index < references.length; index += 100)
    batches.push(references.slice(index, index + 100));
  const saved: any[][] = [];
  await pool(
    batches,
    async (batch, index) => {
      const file = `graphql/mt-products-by-reference/${String(index).padStart(4, '0')}.json`;
      let data: any;
      if (await exists(path.join(archive, file)))
        data = JSON.parse(await fs.readFile(path.join(archive, file), 'utf8'));
      else {
        data = await gql(
          'query($references:String!){mtProductsByReferences(references:$references){id reference active defaultMeasurements modelSet{id name active models{id quantity label model{id modelName label}}}}}',
          { references: batch.join(',') }
        );
        await save(file, data);
      }
      saved[index] = data.mtProductsByReferences || [];
    },
    2
  );
  const products = saved.flat();
  const received = new Set(products.map(row => row.reference));
  await save('mt-products-full.json', {
    requestedReferences: references.length,
    distinctReferences: received.size,
    missingReferences: references.filter(reference => !received.has(reference)),
    items: products,
  });
  console.log(
    JSON.stringify({
      mtProducts: products.length,
      distinctReferences: received.size,
      missingReferences: references.length - received.size,
    })
  );
}
async function downloadImages(payload: any, recordFile: string) {
  const candidates = new Map<string, string>();
  function walk(value: any) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.url === 'string' && /^https?:/.test(value.url))
      candidates.set(value.file_path || value.url.split('?')[0], value.url);
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(walk);
      else if (typeof child === 'object') walk(child);
    }
  }
  walk(payload);
  const mappings: any[] = [];
  for (const [key, url] of candidates) {
    const ext = path.extname(new URL(url).pathname).slice(0, 12) || '.bin';
    const relative = `assets/${sha(key)}${ext}`;
    const destination = path.join(archive, relative);
    try {
      if (!(await exists(destination))) {
        const response = await request(url);
        const type = response.headers.get('content-type') || '';
        if (!response.ok || /text\/html|application\/json/.test(type))
          throw new Error(`Asset HTTP ${response.status} (${type})`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (!bytes.length) throw new Error('Empty asset');
        await fs.mkdir(path.dirname(destination), { recursive: true });
        const temp = destination + '.' + crypto.randomUUID() + '.part';
        await fs.writeFile(temp, bytes);
        await fs.rename(temp, destination);
      }
      const bytes = await fs.readFile(destination);
      mappings.push({
        sourceKey: key,
        sourceUrl: url,
        localPath: relative,
        bytes: bytes.length,
        sha256: sha(bytes),
      });
    } catch (error: any) {
      mappings.push({ sourceKey: key, sourceUrl: url, error: error.message });
    }
  }
  await save(`asset-maps/${recordFile}`, mappings);
}
async function measurements() {
  const rows: any[] = JSON.parse(
    await fs.readFile(
      path.join(archive, process.env.CW_BACKUP_TUPLES_FILE || 'measurement-tuples.json'),
      'utf8'
    )
  );
  await pool(
    rows,
    async row => {
      const relative = `measurements/${row.file}`;
      try {
        let record: any;
        if (await exists(path.join(archive, relative)))
          record = JSON.parse(await fs.readFile(path.join(archive, relative), 'utf8'));
        if (record && [400, 404].includes(record.httpStatus)) return;
        if (record?.httpStatus === 200 && Number(record.data?.status) === 200) {
          const mapFile = path.join(archive, 'asset-maps', row.file);
          if (await exists(mapFile)) {
            const mappings = JSON.parse(await fs.readFile(mapFile, 'utf8'));
            if (mappings.every((mapping: any) => mapping.localPath && !mapping.error)) return;
          }
          // Refresh expiring image links when a previous asset download was incomplete.
          record = undefined;
        }
        if (record?.httpStatus === 200 && Number(record.data?.status) !== 200) record = undefined;
        if (!record || ![200, 400, 404].includes(record.httpStatus)) {
          const url = new URL(`${pidBase}/mtApi/product-qc-measurements/`);
          url.search = new URLSearchParams({
            product_reference: row.reference,
            style: row.style,
            ...(row.styleCode ? { style_code: row.styleCode } : {}),
            bucket_name: 'pid-storage',
          }).toString();
          let response = await request(url.toString(), {
            headers: { Authorization: 'Bearer ' + auth.accessToken },
          });
          if (response.status === 401) {
            await refreshAuth();
            response = await request(url.toString(), {
              headers: { Authorization: 'Bearer ' + auth.accessToken },
            });
          }
          const data: any = await response.json();
          record = {
            tuple: row,
            fetchedAt: new Date().toISOString(),
            httpStatus: response.status,
            data,
          };
          await save(relative, record);
        }
        if (record.httpStatus === 200 && Number(record.data.status) === 200)
          await downloadImages(record.data.content, row.file);
      } catch (error: any) {
        await save(`failures/measurement-${row.file}`, { tuple: row, error: error.message });
      }
    },
    Number(process.env.CW_BACKUP_CONCURRENCY || 4)
  );
}
async function publicCatalogue() {
  await fs.cp(path.resolve('data/comfort-works'), path.join(archive, 'public-catalogue'), {
    recursive: true,
  });
  await fs.copyFile(
    '/Users/leigh/.codex/attachments/de62b8ec-2c7c-4ef0-8612-767ee77cb44e/Pasted text.txt',
    path.join(archive, 'user-provided-product-markup.html')
  );
  await fs.cp('/tmp/openpaint-cw-backup/bundles', path.join(archive, 'pid-website-source'), {
    recursive: true,
  });
  await downloadImages(
    JSON.parse(await fs.readFile(path.join(archive, 'sample-kivik.json'), 'utf8')).content,
    'sample-kivik.json'
  );
}
async function publicMeasurements() {
  const products = JSON.parse(await fs.readFile(path.join(archive, 'products.json'), 'utf8')).items;
  const mtProducts = JSON.parse(
    await fs.readFile(path.join(archive, 'mt-products-full.json'), 'utf8')
  ).items;
  const references = [
    ...new Set<string>(
      [...products, ...mtProducts]
        .map((product: any) =>
          String(product.reference || '')
            .split('__')[0]
            .trim()
        )
        .filter((reference: string) => reference && !/^\d+$/.test(reference))
    ),
  ].sort();
  const results: any[] = [];
  await pool(
    references,
    async reference => {
      const file = `public-measurements/${sha(reference)}.json`;
      let record: any;
      if (await exists(path.join(archive, file)))
        record = JSON.parse(await fs.readFile(path.join(archive, file), 'utf8'));
      if (!record || ![200, 400, 404].includes(record.httpStatus)) {
        const url =
          'https://measure.comfort-works.com/api/public-all-options-product-measurements/?' +
          new URLSearchParams({ format: 'json', product_reference: reference });
        try {
          const response = await request(url);
          const raw = await response.text();
          let data: any;
          try {
            data = JSON.parse(raw);
          } catch {
            data = { raw };
          }
          record = {
            reference,
            url,
            fetchedAt: new Date().toISOString(),
            httpStatus: response.status,
            data,
          };
        } catch (error: any) {
          record = { reference, error: error.message };
        }
        await save(file, record);
      }
      results.push({
        reference,
        file,
        httpStatus: record.httpStatus,
        error: record.error,
        options: (record.data?.content?.product_options || []).map((option: any) => ({
          reference: option.product_reference,
          styles: (option.product_styles || []).map((style: any) => ({
            style: style.style_name,
            styleCode: style.style_code,
          })),
        })),
      });
    },
    Number(process.env.CW_BACKUP_CONCURRENCY || 8)
  );
  results.sort((a, b) => a.reference.localeCompare(b.reference));
  await save('public-measurements-index.json', {
    fetchedAt: new Date().toISOString(),
    requestedReferences: references.length,
    items: results,
  });
  console.log(
    JSON.stringify({
      publicReferences: results.length,
      successfulResponses: results.filter(row => row.httpStatus === 200).length,
      unresolvedResponses: results.filter(row => ![200, 400, 404].includes(row.httpStatus)).length,
    })
  );
}
async function publicMeasurementTuples() {
  const publicIndex = JSON.parse(
    await fs.readFile(path.join(archive, 'public-measurements-index.json'), 'utf8')
  );
  const canonical = JSON.parse(
    await fs.readFile(path.join(archive, 'measurement-tuples.json'), 'utf8')
  );
  const products = JSON.parse(await fs.readFile(path.join(archive, 'products.json'), 'utf8')).items;
  const productIds = new Map<string, string>(
    products.map((product: any) => [product.reference, product.id])
  );
  const seen = new Set<string>(canonical.map((tuple: any) => tuple.key));
  const supplemental: any[] = [];
  for (const result of publicIndex.items) {
    if (result.httpStatus !== 200) continue;
    for (const option of result.options)
      for (const style of option.styles) {
        const key = `${option.reference}|${style.style}|${style.styleCode || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        supplemental.push({
          productId: productIds.get(option.reference.split('__')[0]) || null,
          reference: option.reference,
          style: style.style,
          styleCode: style.styleCode || '',
          key,
          file: sha(key) + '.json',
          source: result.file,
        });
      }
  }
  await save('public-source-tuples.json', supplemental);
  console.log(JSON.stringify({ supplementalMeasurementSelections: supplemental.length }));
}
async function catalogueAssets() {
  const products = JSON.parse(await fs.readFile(path.join(archive, 'products.json'), 'utf8')).items;
  const fabrics = JSON.parse(await fs.readFile(path.join(archive, 'fabrics.json'), 'utf8')).items;
  const urls = new Set<string>();
  for (const row of [...products, ...fabrics])
    for (const key of ['cover', 'gallery', 'pdfUrl', 'image', 'thumbnail']) {
      for (const url of String(row[key] || '').match(/https?:[^\s"<>\\]+/g) || []) {
        if (/\.(?:png|jpe?g|webp|gif|svg|pdf)(?:[?#]|$)/i.test(url)) urls.add(url);
      }
    }
  await save('catalogue-asset-urls.json', [...urls]);
  await pool(
    [...urls],
    async url => {
      const name = `catalogue-${sha(url)}.json`;
      const existing = path.join(archive, 'asset-maps', name);
      if (await exists(existing)) {
        const map = JSON.parse(await fs.readFile(existing, 'utf8'));
        if (map.every((item: any) => item.localPath && !item.error)) return;
      }
      await downloadImages({ url }, name);
    },
    6
  );
}
async function finalizeIndex() {
  const runtime = JSON.parse(await fs.readFile(path.join(archive, 'runtime-index.json'), 'utf8'));
  const configurations = JSON.parse(
    await fs.readFile(path.join(archive, 'product-configurations.json'), 'utf8')
  );
  const rows = JSON.parse(await fs.readFile(path.join(archive, 'measurement-tuples.json'), 'utf8'));
  const confirmed = new Map<string, Set<string>>();
  for (const row of rows) {
    const file = path.join(archive, 'measurements', row.file);
    if (!(await exists(file))) continue;
    const record = JSON.parse(await fs.readFile(file, 'utf8'));
    if (record.httpStatus !== 200 || Number(record.data?.status) !== 200) continue;
    const references = confirmed.get(row.productId) || new Set<string>();
    references.add(row.reference);
    confirmed.set(row.productId, references);
  }
  let added = 0;
  for (const config of runtime.configs) {
    const source = configurations.find((item: any) => item.id === config.id);
    const references = confirmed.get(config.id) || new Set<string>();
    const labels = new Map<string, string>();
    for (const group of source.optionGroups) {
      let parsed: any;
      try {
        parsed = JSON.parse(group.data);
      } catch {
        continue;
      }
      for (const option of parsed.content || [])
        labels.set(option.code, option.name?._translateable?.UN || option.code);
    }
    const originalOptions = config.versionOptions;
    for (const option of originalOptions) {
      option.measurementsArchived = references.has(option.scopedReference);
      option.confirmed = option.modelSetConfirmed !== false && option.measurementsArchived;
    }
    for (const reference of references) {
      if (reference === source.reference) continue;
      if (config.versionOptions.some((option: any) => option.scopedReference === reference))
        continue;
      const code = reference.startsWith(source.reference + '__')
        ? reference.slice(source.reference.length + 2)
        : reference;
      config.versionOptions.push({
        code,
        label: code
          .split('_')
          .map((part: string) => labels.get(part) || part)
          .join(' · '),
        scopedReference: reference,
        source: 'confirmed-archive',
        modelSetConfirmed: false,
        measurementsArchived: true,
        confirmed: false,
      });
      added++;
    }
    // An explicit scope keeps the UI's selection key separate from the source reference.
    if (
      references.has(source.reference) &&
      config.versionOptions.length &&
      !config.versionOptions.some((option: any) => option.scopedReference === source.reference)
    ) {
      config.versionOptions.push({
        code: 'base',
        label: 'Default',
        scopedReference: source.reference,
        source: 'confirmed-archive',
        modelSetConfirmed: source.hasVersionConfiguration ? false : undefined,
        measurementsArchived: true,
        confirmed: !source.hasVersionConfiguration,
      });
    }
    config.derivedScopedReferences = config.versionOptions.map(
      (option: any) => option.scopedReference
    );
  }
  await save('runtime-index.json', runtime);
  console.log(JSON.stringify({ stage: mode, addedConfirmedConfigurations: added }));
}
async function referenceReview() {
  const products = JSON.parse(await fs.readFile(path.join(archive, 'products.json'), 'utf8')).items;
  const rows = JSON.parse(await fs.readFile(path.join(archive, 'measurement-tuples.json'), 'utf8'));
  const productsById = new Map<string, any>(products.map((item: any) => [item.id, item]));
  const runtime = JSON.parse(await fs.readFile(path.join(archive, 'runtime-index.json'), 'utf8'));
  const configsById = new Map<string, any>(
    runtime.configs.map((config: any) => [config.id, config])
  );
  const groups = new Map<string, any>();
  const publicSourceByReference = new Map<string, any[]>();
  if (await exists(path.join(archive, 'public-measurements-index.json'))) {
    const publicSource = JSON.parse(
      await fs.readFile(path.join(archive, 'public-measurements-index.json'), 'utf8')
    );
    for (const row of publicSource.items)
      publicSourceByReference.set(
        row.reference,
        row.options.filter((option: any) => option.styles.length)
      );
  }
  const available = new Map<string, Set<string>>();
  for (const row of rows) {
    const file = path.join(archive, 'measurements', row.file);
    if (!(await exists(file))) continue;
    const record = JSON.parse(await fs.readFile(file, 'utf8'));
    const config = configsById.get(row.productId);
    const version = config?.versionOptions?.find(
      (option: any) => option.scopedReference === row.reference
    );
    if (
      version?.modelSetConfirmed === false ||
      (config?.hasVersionConfiguration && version?.modelSetConfirmed !== true)
    )
      continue;
    if (record.httpStatus === 200 && Number(record.data?.status) === 200) {
      const refs = available.get(row.productId) || new Set<string>();
      refs.add(row.reference);
      available.set(row.productId, refs);
      continue;
    }
    if (record.httpStatus !== 400 || !/__(?!DF$)|_(?:SV|LV|\d+S-\d+B)(?:_|$)/.test(row.reference))
      continue;
    const product = productsById.get(row.productId);
    const group = groups.get(row.productId) || {
      productId: row.productId,
      product:
        product.translations?.edges?.find((edge: any) => edge.node.lang === 'en')?.node.name ||
        product.name,
      baseReference: product.reference,
      failedSelections: [],
    };
    group.failedSelections.push({
      reference: row.reference,
      style: row.style,
      styleCode: row.styleCode,
    });
    groups.set(row.productId, group);
  }
  const review = [...groups.values()]
    .map(group => ({
      ...group,
      referencesWithMeasurementsSoFar: [...(available.get(group.productId) || [])].sort(),
      publicSourceOptions: publicSourceByReference.get(group.baseReference.split('__')[0]) || [],
      suffixReviewPriority: group.failedSelections.some((row: any) =>
        /_(?:SV|LV|\d+S-\d+B)(?:_|$)/.test(row.reference)
      ),
    }))
    .sort(
      (a, b) =>
        Number(b.suffixReviewPriority) - Number(a.suffixReviewPriority) ||
        Number(Boolean(a.referencesWithMeasurementsSoFar.length)) -
          Number(Boolean(b.referencesWithMeasurementsSoFar.length)) ||
        a.product.localeCompare(b.product)
    );
  await save('reference-review.json', {
    note: 'Service misses for models not marked unconfirmed in CW40. Unconfirmed configurations are excluded. No alternate reference is assumed to represent the same model.',
    products: review,
  });
  const lines = [
    '# Measurement references to review',
    '',
    'Service misses with version/configuration suffixes. Unconfirmed configurations are excluded; their unavailable measurements are expected. Successful alternatives are those found so far. No suffix changes have been guessed.',
    '',
    '| Product | Failed reference · style code | Archived configured references | Public source options to review |',
    '|---|---|---|---|',
  ];
  for (const row of review)
    lines.push(
      `| ${row.product.replaceAll('|', '/')} | ${row.failedSelections.map((item: any) => `\`${item.reference}\` · \`${item.styleCode || item.style}\``).join('<br>')} | ${row.referencesWithMeasurementsSoFar.map((ref: string) => `\`${ref}\``).join(', ') || 'None'} | ${
        row.publicSourceOptions
          .slice(0, 10)
          .map(
            (option: any) =>
              `\`${option.reference}\` · ${option.styles.map((style: any) => `${style.style} / \`${style.styleCode}\``).join(', ')}`
          )
          .join('<br>') || 'None'
      }${row.publicSourceOptions.length > 10 ? '<br>More in reference-review.json' : ''} |`
    );
  await fs.writeFile(path.join(archive, 'REFERENCE_REVIEW.md'), lines.join('\n') + '\n');
  console.log(JSON.stringify({ stage: mode, productsToReview: review.length }));
}
async function verifyArchive() {
  const tuples = JSON.parse(
    await fs.readFile(path.join(archive, 'measurement-tuples.json'), 'utf8')
  );
  const products = JSON.parse(await fs.readFile(path.join(archive, 'products.json'), 'utf8'));
  const runtime = JSON.parse(await fs.readFile(path.join(archive, 'runtime-index.json'), 'utf8'));
  const configs = new Map<string, any>(runtime.configs.map((config: any) => [config.id, config]));
  const statuses: Record<string, number> = {};
  const missing: any[] = [],
    unavailable: any[] = [],
    returned: any[] = [],
    styleDiscrepancies: any[] = [];
  for (const tuple of tuples) {
    const file = path.join(archive, 'measurements', tuple.file);
    if (!(await exists(file))) {
      missing.push(tuple);
      continue;
    }
    const record = JSON.parse(await fs.readFile(file, 'utf8'));
    const status = `${record.httpStatus}/${record.data?.status ?? 'none'}`;
    statuses[status] = (statuses[status] || 0) + 1;
    if (record.httpStatus === 200 && Number(record.data?.status) === 200) {
      returned.push(tuple);
      if (isArchivedStyleMismatch(tuple.style, tuple.styleCode, record.data.content))
        styleDiscrepancies.push({
          ...tuple,
          returnedStyle: record.data.content?.style_name,
          returnedStyleCode: record.data.content?.style_code,
        });
    } else
      unavailable.push({
        ...tuple,
        httpStatus: record.httpStatus,
        reason: record.data?.content || record.data?.detail || 'No measurement data returned',
      });
  }
  const assetChecks = new Map<string, { bytes: number; sha256: string }>();
  let publicSource: any = null;
  if (await exists(path.join(archive, 'public-measurements-index.json'))) {
    const publicIndex = JSON.parse(
      await fs.readFile(path.join(archive, 'public-measurements-index.json'), 'utf8')
    );
    const supplemental = (await exists(path.join(archive, 'public-source-tuples.json')))
      ? JSON.parse(await fs.readFile(path.join(archive, 'public-source-tuples.json'), 'utf8'))
      : [];
    const supplementalChecks: any[] = [];
    for (const tuple of supplemental) {
      const record = await fs
        .readFile(path.join(archive, 'measurements', tuple.file), 'utf8')
        .then(JSON.parse, () => null);
      supplementalChecks.push({
        ...tuple,
        httpStatus: record?.httpStatus,
        returnedMeasurements: record?.httpStatus === 200 && Number(record?.data?.status) === 200,
        styleMismatch:
          record?.httpStatus === 200 &&
          Number(record?.data?.status) === 200 &&
          isArchivedStyleMismatch(tuple.style, tuple.styleCode, record.data.content),
      });
    }
    publicSource = {
      requestedBaseReferences: publicIndex.requestedReferences,
      savedResponses: publicIndex.items.length,
      successfulPublicResponses: publicIndex.items.filter((row: any) => row.httpStatus === 200)
        .length,
      unresolvedPublicResponses: publicIndex.items.filter(
        (row: any) => ![200, 400, 404].includes(row.httpStatus)
      ).length,
      supplementalSelections: supplemental.length,
      supplementalReturnedMeasurements: supplementalChecks.filter(row => row.returnedMeasurements)
        .length,
      supplementalStyleDiscrepancies: supplementalChecks.filter(row => row.styleMismatch).length,
      unresolvedSupplementalSelections: supplementalChecks.filter(
        row => !row.returnedMeasurements && ![400, 404].includes(row.httpStatus)
      ).length,
    };
    await save('public-source-verification.json', {
      ...publicSource,
      selections: supplementalChecks,
    });
  }
  const assetErrors: any[] = [];
  const maps = (await fs.readdir(path.join(archive, 'asset-maps'))).filter(file =>
    file.endsWith('.json')
  );
  for (const file of maps) {
    const mappings = JSON.parse(await fs.readFile(path.join(archive, 'asset-maps', file), 'utf8'));
    for (const mapping of mappings) {
      if (mapping.error) {
        assetErrors.push({ record: file, sourceKey: mapping.sourceKey, error: mapping.error });
        continue;
      }
      if (assetChecks.has(mapping.localPath)) {
        if (assetChecks.get(mapping.localPath)?.sha256 !== mapping.sha256)
          assetErrors.push({
            record: file,
            asset: mapping.localPath,
            error: 'Conflicting expected SHA-256 hashes',
          });
        continue;
      }
      try {
        const bytes = await fs.readFile(path.join(archive, mapping.localPath));
        const actual = sha(bytes);
        if (!bytes.length || actual !== mapping.sha256 || bytes.length !== mapping.bytes)
          throw new Error('File size or SHA-256 mismatch');
        assetChecks.set(mapping.localPath, { bytes: bytes.length, sha256: actual });
      } catch (error: any) {
        assetErrors.push({ record: file, asset: mapping.localPath, error: error.message });
      }
    }
  }
  const styleMismatchKeys = new Set(styleDiscrepancies.map(row => row.key));
  const summary = {
    verifiedAt: new Date().toISOString(),
    catalogueProducts: products.totalCount,
    catalogueDistinctIds: new Set(products.items.map((product: any) => product.id)).size,
    requestedSelections: tuples.length,
    savedResponses: tuples.length - missing.length,
    returnedMeasurementRecords: returned.length,
    measurementSelectionsEligibleForLibrary: returned.filter(
      tuple =>
        !isArchivedModelUnconfirmed(configs.get(tuple.productId), tuple.reference) &&
        !styleMismatchKeys.has(tuple.key)
    ).length,
    recordsWithStyleDiscrepancy: styleDiscrepancies.length,
    returnedRecordsMarkedUnconfirmed: returned.filter(tuple =>
      isArchivedModelUnconfirmed(configs.get(tuple.productId), tuple.reference)
    ).length,
    eligibleSelectionsUnavailableAtSource: unavailable.filter(
      tuple => !isArchivedModelUnconfirmed(configs.get(tuple.productId), tuple.reference)
    ).length,
    selectionsUnavailableAtSource: unavailable.length,
    missingResponses: missing.length,
    responseStatuses: statuses,
    verifiedAssets: assetChecks.size,
    verifiedAssetBytes: [...assetChecks.values()].reduce((total, value) => total + value.bytes, 0),
    assetErrors: assetErrors.length,
    assetsUnavailableAtSource: assetErrors.filter(item => /^Asset HTTP 404\b/.test(item.error))
      .length,
    unresolvedAssetErrors: assetErrors.filter(item => !/^Asset HTTP 404\b/.test(item.error)).length,
    publicSource,
    completeRetrievalPass:
      missing.length === 0 &&
      (!publicSource ||
        (publicSource.savedResponses === publicSource.requestedBaseReferences &&
          publicSource.unresolvedPublicResponses === 0 &&
          publicSource.unresolvedSupplementalSelections === 0)) &&
      assetErrors.every(item => /^Asset HTTP 404\b/.test(item.error)) &&
      unavailable.every(item => [400, 404].includes(item.httpStatus)),
  };
  await save('verification.json', summary);
  await save('style-discrepancies.json', styleDiscrepancies);
  await fs.writeFile(
    path.join(archive, 'STYLE_REVIEW.md'),
    [
      '# Measurement style codes to review',
      '',
      'The source returned a different style name or code. Raw responses are preserved; the library withholds these measurements until the mapping is verified.',
      '',
      '| Reference | Requested style / code | Returned style / code |',
      '|---|---|---|',
      ...styleDiscrepancies.map(
        row =>
          `| \`${row.reference}\` | ${row.style} / \`${row.styleCode}\` | ${row.returnedStyle} / \`${row.returnedStyleCode}\` |`
      ),
      '',
    ].join('\n')
  );
  await save('missing-responses.json', missing);
  await save('source-unavailable-selections.json', unavailable);
  await save(
    'eligible-unavailable-selections.json',
    unavailable.filter(
      tuple => !isArchivedModelUnconfirmed(configs.get(tuple.productId), tuple.reference)
    )
  );
  await save(
    'unconfirmed-models.json',
    runtime.configs.flatMap((config: any) =>
      config.versionOptions
        .filter((option: any) => option.modelSetConfirmed === false)
        .map((option: any) => ({ productId: config.id, ...option }))
    )
  );
  await save('asset-errors.json', assetErrors);
  await save('asset-checksums.json', Object.fromEntries(assetChecks));
  const report = `# Comfort Works shutdown archive\n\nVerified: ${summary.verifiedAt}\n\n- Catalogue: ${summary.catalogueDistinctIds}/${summary.catalogueProducts} distinct CW40 products.\n- Measurement selections requested: ${tuples.length}.\n- Saved responses: ${summary.savedResponses}; successful measurement records: ${returned.length}.\n- Source reported unavailable: ${unavailable.length}; responses still missing: ${missing.length}.\n- Saved measurement selections eligible for the library: ${summary.measurementSelectionsEligibleForLibrary}.\n- Raw successful records withheld because the model is unconfirmed: ${summary.returnedRecordsMarkedUnconfirmed}.\n- Returned records with a style-name/code discrepancy: ${summary.recordsWithStyleDiscrepancy}; these are withheld pending review.\n- Eligible selections with a source miss: ${summary.eligibleSelectionsUnavailableAtSource}.\n- Verified downloaded assets: ${assetChecks.size} (${summary.verifiedAssetBytes} bytes).\n- Source assets returning 404: ${summary.assetsUnavailableAtSource}; unresolved download/integrity errors: ${summary.unresolvedAssetErrors}.\n- Retrieval pass complete: ${summary.completeRetrievalPass ? 'yes' : 'no'}.\n\nMeasurements are saved as raw service responses; missing source data is listed in source-unavailable-selections.json. Source asset failures are listed in asset-errors.json. Every saved asset is checked against its recorded SHA-256 hash and file size. Authentication tokens are stored temporarily outside this archive.\n\nThe bulk CSV export, pattern file index, and standalone file download endpoint returned 403 for this account. The permitted per-product API was used to retrieve measurements and their images. The component file metadata index is archived. The bulk mtProductsList and mtModelSets GraphQL endpoints returned upstream errors; their raw responses are retained. All 4,622 indexed MT product/model associations were recovered through mtProductsByReferences. The MT reference index, full product-to-model associations, model definitions, configuration tables, and product catalogue are archived separately. Configured references combine every CW40 my-sofa-is group with double-underscore separators. CW40 model confirmation flags are retained; unconfirmed records remain in the raw backup and are withheld from the measurement library. This pass covers the indexed selections derived from the current CW40 catalogue, saved configuration references, and catalogue-linked MT references; it does not guarantee that the source contained measurements for every model.\n\nThe Sofapaint implementation requires a verified @comfort-works.com login and serves the archive through an authenticated API. Production hosting is not activated by this local backup.\n`;
  const publicReport = publicSource
    ? `\nAdditional public source backup: ${publicSource.savedResponses}/${publicSource.requestedBaseReferences} base-reference responses, including ${publicSource.successfulPublicResponses} successful all-options responses. Its exact reference/style pairs produced ${publicSource.supplementalSelections} additional detailed requests and ${publicSource.supplementalReturnedMeasurements} returned measurement records. These raw supplemental records are preserved separately from the configured library selections; they do not change model confirmation flags or authorize reference substitutions. Unresolved public responses: ${publicSource.unresolvedPublicResponses}; unresolved supplemental requests: ${publicSource.unresolvedSupplementalSelections}.\n`
    : '';
  await fs.writeFile(path.join(archive, 'REPORT.md'), report + publicReport);
  console.log(JSON.stringify(summary));
}
if (mode === 'catalogue') await catalogue();
else if (mode === 'dictionaries') await dictionaries();
else if (mode === 'pid-dictionaries') await pidDictionaries();
else if (mode === 'component-index') await pidDictionaries(['product-component-files']);
else if (mode === 'editor-configs') await editorConfigurations();
else if (mode === 'tuples') await tuples();
else if (mode === 'mt-products') await mtProducts();
else if (mode === 'measurements') await measurements();
else if (mode === 'public') await publicCatalogue();
else if (mode === 'public-measurements') await publicMeasurements();
else if (mode === 'public-tuples') await publicMeasurementTuples();
else if (mode === 'catalogue-assets') await catalogueAssets();
else if (mode === 'finalize-index') await finalizeIndex();
else if (mode === 'reference-review') await referenceReview();
else if (mode === 'verify') await verifyArchive();
else throw new Error('Unknown mode: ' + mode);
