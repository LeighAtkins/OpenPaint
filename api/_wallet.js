import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const PET_CATALOG = [
  { id: 'cat-1', name: 'Tabby Cat', type: 'cat', cost: 50 },
  { id: 'cat-2', name: 'Tuxedo Cat', type: 'cat', cost: 50 },
  { id: 'cat-3', name: 'Ginger Cat', type: 'cat', cost: 75 },
  { id: 'cat-4', name: 'Siamese Cat', type: 'cat', cost: 75 },
  { id: 'cat-5', name: 'Calico Cat', type: 'cat', cost: 100 },
  { id: 'cat-6', name: 'Black Cat', type: 'cat', cost: 100 },
  { id: 'dog-1', name: 'Golden Retriever', type: 'dog', cost: 50 },
  { id: 'dog-2', name: 'Akita', type: 'dog', cost: 50 },
  { id: 'dog-3', name: 'Great Dane', type: 'dog', cost: 75 },
  { id: 'dog-4', name: 'Schnauzer', type: 'dog', cost: 75 },
  { id: 'dog-5', name: 'Saint Bernard', type: 'dog', cost: 100 },
  { id: 'dog-6', name: 'Siberian Husky', type: 'dog', cost: 100 },
];

const COINS_PER_SAVE = 10;
const DAILY_COIN_CAP = 100;
const EARN_COOLDOWN_MS = 5 * 60 * 1000;

function getSupabaseAdmin() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function getBearerToken(req) {
  const authHeader = String(req.headers?.authorization || '');
  if (!authHeader.toLowerCase().startsWith('bearer ')) return null;
  return authHeader.slice(7).trim() || null;
}

async function getCloudAuthUser(req) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { user: null };
  }

  const token = getBearerToken(req);
  if (!token) {
    return {
      error: {
        statusCode: 401,
        body: { error: { code: 'auth_required', message: 'Authorization required' } },
      },
    };
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return {
      error: {
        statusCode: 401,
        body: { error: { code: 'invalid_token', message: error?.message || 'Invalid token' } },
      },
    };
  }

  return { user: data.user };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const authResult = await getCloudAuthUser(req);
  if (authResult.error) {
    return res.status(authResult.error.statusCode).json(authResult.error.body);
  }

  const userId = authResult.user.id;
  const supabase = getSupabaseAdmin();

  // Determine route from query or path
  const path = (req.query.route || '').toString().replace(/^\//, '') || '';
  const isEarn = path === 'wallet/earn' || req.url?.includes('earn');
  const isSpend = path === 'wallet/spend' || req.url?.includes('spend');
  const isEquip = path === 'pets/equip' || req.url?.includes('equip');

  // GET /api/wallet - get balance and inventory
  if (req.method === 'GET' && !isEarn && !isSpend && !isEquip) {
    const { data: wallet } = await supabase
      .from('wallets')
      .select('balance, equipped_pet')
      .eq('user_id', userId)
      .maybeSingle();

    let balance = 0;
    let equippedPet = null;

    if (wallet) {
      balance = wallet.balance;
      equippedPet = wallet.equipped_pet;
    } else {
      await supabase.from('wallets').insert({ user_id: userId, balance: 0 });
    }

    const { data: pets } = await supabase
      .from('pet_inventory')
      .select('pet_id')
      .eq('user_id', userId);

    return res.json({
      success: true,
      balance,
      equippedPet,
      unlockedPets: (pets || []).map(p => p.pet_id),
      catalog: PET_CATALOG,
    });
  }

  // POST /api/wallet/earn - earn coins
  if (req.method === 'POST' && isEarn) {
    const { projectId, saveTimestamp, projectData } = req.body || {};

    if (!projectId || !saveTimestamp) {
      return res
        .status(400)
        .json({ success: false, message: 'projectId and saveTimestamp required' });
    }

    const { data: wallet } = await supabase
      .from('wallets')
      .select('balance')
      .eq('user_id', userId)
      .maybeSingle();

    if (!wallet) {
      await supabase.from('wallets').insert({ user_id: userId, balance: 0 });
    }

    // Validate qualifying save
    if (projectData) {
      const views = projectData.views || {};
      const viewKeys = Object.keys(views);
      const hasImage = viewKeys.some(k => {
        const v = views[k];
        return v && (v.image || v.backgroundImage || v.imageData);
      });
      const totalStrokes = viewKeys.reduce((sum, k) => {
        const v = views[k];
        return sum + (v?.vectorStrokes?.length || 0) + (v?.lineStrokes?.length || 0);
      }, 0);

      if (!hasImage || totalStrokes < 3) {
        return res.json({
          success: true,
          earned: 0,
          balance: wallet?.balance || 0,
          reason: 'not_qualifying',
        });
      }
    }

    // Cooldown check
    const { data: lastTx } = await supabase
      .from('coin_transactions')
      .select('created_at')
      .eq('user_id', userId)
      .gt('amount', 0)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastTx) {
      const elapsed = Date.now() - new Date(lastTx.created_at).getTime();
      if (elapsed < EARN_COOLDOWN_MS) {
        return res.json({
          success: true,
          earned: 0,
          balance: wallet?.balance || 0,
          reason: 'cooldown',
        });
      }
    }

    // Daily cap
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { data: todayTxs } = await supabase
      .from('coin_transactions')
      .select('amount')
      .eq('user_id', userId)
      .gt('amount', 0)
      .gte('created_at', todayStart.toISOString());

    const todayTotal = (todayTxs || []).reduce((s, t) => s + t.amount, 0);
    if (todayTotal >= DAILY_COIN_CAP) {
      return res.json({
        success: true,
        earned: 0,
        balance: wallet?.balance || 0,
        reason: 'daily_cap',
      });
    }

    // Idempotency
    const idempotencyKey = `${userId}:${projectId}:${saveTimestamp}`;
    const { error: txError } = await supabase.from('coin_transactions').insert({
      user_id: userId,
      amount: COINS_PER_SAVE,
      reason: 'cloud_save',
      idempotency_key: idempotencyKey,
    });

    if (txError) {
      if (txError.code === '23505') {
        return res.json({
          success: true,
          earned: 0,
          balance: wallet?.balance || 0,
          reason: 'already_earned',
        });
      }
      throw txError;
    }

    await supabase.rpc('increment_wallet_balance', { p_user_id: userId, p_amount: COINS_PER_SAVE });

    const { data: updated } = await supabase
      .from('wallets')
      .select('balance')
      .eq('user_id', userId)
      .single();

    return res.json({ success: true, earned: COINS_PER_SAVE, balance: updated?.balance || 0 });
  }

  // POST /api/wallet/spend - purchase pet
  if (req.method === 'POST' && isSpend) {
    const { petId } = req.body || {};

    if (!petId) {
      return res.status(400).json({ success: false, message: 'petId is required' });
    }

    const catalogEntry = PET_CATALOG.find(p => p.id === petId);
    if (!catalogEntry) {
      return res.status(400).json({ success: false, message: 'Invalid petId' });
    }

    const { data: existing } = await supabase
      .from('pet_inventory')
      .select('pet_id')
      .eq('user_id', userId)
      .eq('pet_id', petId)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ success: false, message: 'Pet already owned' });
    }

    const { data: deducted } = await supabase.rpc('decrement_wallet_balance', {
      p_user_id: userId,
      p_amount: catalogEntry.cost,
    });

    if (!deducted) {
      return res.status(400).json({ success: false, message: 'Insufficient balance' });
    }

    await supabase.from('coin_transactions').insert({
      user_id: userId,
      amount: -catalogEntry.cost,
      reason: `purchase_pet:${petId}`,
    });

    await supabase.from('pet_inventory').insert({ user_id: userId, pet_id: petId });

    const { data: wallet } = await supabase
      .from('wallets')
      .select('balance')
      .eq('user_id', userId)
      .single();

    return res.json({ success: true, petId, balance: wallet?.balance || 0 });
  }

  // POST /api/pets/equip - equip pet
  if (req.method === 'POST' && isEquip) {
    const { petId } = req.body || {};

    if (petId) {
      const { data: owned } = await supabase
        .from('pet_inventory')
        .select('pet_id')
        .eq('user_id', userId)
        .eq('pet_id', petId)
        .maybeSingle();

      if (!owned) {
        return res.status(400).json({ success: false, message: 'Pet not owned' });
      }
    }

    await supabase
      .from('wallets')
      .update({ equipped_pet: petId || null, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    return res.json({ success: true, equippedPet: petId || null });
  }

  return res.status(404).json({ error: 'Route not found', path: req.url });
}
