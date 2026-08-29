// Diagnostics background task: exercises the non-heavy Layla SDK surface once.
// Runs headlessly in the host's QuickJS runtime — no imports; the host injects
// a ready `layla` instance before this script is evaluated. Heavy generation
// flows (chat completions, image/music generation, TTS audio) and device
// interaction (STT, background audio) are intentionally not called here.
//
// The host evaluates task.js as a classic script (JS_EVAL_TYPE_GLOBAL), where
// top-level `await` is a syntax error. Wrap the async body in an async IIFE and
// let the returned promise be the script's completion value — the host awaits a
// top-level promise and records its resolved value as the run's output.

console.log('Diagnostics task.js starting.');

// Completion value — the returned promise resolves to the run's output.
(async () => {
  const results = [];

  async function check(name, fn) {
    const start = Date.now();
    try {
      const detail = (await fn()) || '';
      results.push({ name, ok: true, ms: Date.now() - start, detail });
      console.log(`[pass] ${name} (${Date.now() - start}ms)${detail ? ' — ' + detail : ''}`);
    } catch (e) {
      const error = String((e && e.message) || e);
      results.push({ name, ok: false, ms: Date.now() - start, error });
      console.error(`[fail] ${name} (${Date.now() - start}ms) — ${error}`);
    }
  }

  // --- Contextual ---
  await check('contextual.getExecutionContext', async () => {
    const context = await layla.contextual.getExecutionContext();
    const character = context.character ? context.character.id : 'null';
    return `app_version=${context.app_version}, character=${character}, session=${context.session_id || 'null'}`;
  });

  // --- Characters ---
  let firstCharacter = null;
  await check('characters.list', async () => {
    const characters = await layla.characters.list(0, 5);
    firstCharacter = characters[0] || null;
    const firstName = firstCharacter && firstCharacter.data && firstCharacter.data.data
      ? firstCharacter.data.data.name
      : 'n/a';
    return `${characters.length} character(s), first=${firstName}`;
  });

  await check('characters.getImage', async () => {
    if (!firstCharacter) return 'skipped — no characters installed';
    const src = await layla.characters.getImage(firstCharacter.id);
    return src ? `image src length=${src.length}` : 'no image returned';
  });

  // --- Chat (read-only surfaces; no completions) ---
  await check('chat.getInferenceEngines', async () => {
    const engines = await layla.chat.getInferenceEngines();
    return `${engines.length} engine(s): ${engines.join(', ')}`;
  });

  let latestSessionId = null;
  await check('chat.getChatSessions', async () => {
    if (!firstCharacter) return 'skipped — no characters installed';
    const { sessions } = await layla.chat.getChatSessions(firstCharacter.id);
    latestSessionId = sessions[0] ? sessions[0].session_id : null;
    return `${sessions.length} session(s), latest=${latestSessionId || 'none'}`;
  });

  await check('chat.getChatHistory', async () => {
    if (!latestSessionId) return 'skipped — no chat sessions';
    const history = await layla.chat.getChatHistory(latestSessionId, 0, 5);
    return `${history.length} message(s) in latest session`;
  });

  await check('chat.getScheduledChatMessages', async () => {
    const scheduled = await layla.chat.getScheduledChatMessages();
    return `${scheduled.length} scheduled message(s)`;
  });

  // --- Memories ---
  await check('memories.list', async () => {
    if (!firstCharacter) return 'skipped — no characters installed';
    const memories = await layla.memories.list(firstCharacter.id, 0, 5);
    return `${memories.length} memory(ies)`;
  });

  await check('memories.getTopMemories', async () => {
    if (!firstCharacter) return 'skipped — no characters installed';
    const top = await layla.memories.getTopMemories(firstCharacter.id, 3);
    return `${top.length} top memory(ies)`;
  });

  // --- Personas ---
  await check('personas.get (default)', async () => {
    const persona = await layla.personas.get();
    return `name=${persona.name}`;
  });

  await check('personas.get (character)', async () => {
    if (!firstCharacter) return 'skipped — no characters installed';
    const persona = await layla.personas.get(firstCharacter.id);
    return `name=${persona.name}`;
  });

  // --- TTS / image model listings (metadata only, no generation) ---
  await check('tts.getVoices', async () => {
    const voices = await layla.tts.getVoices();
    return `${voices.length} voice(s)`;
  });

  await check('images.getImageGenerationModels', async () => {
    const models = await layla.images.getImageGenerationModels();
    return `${models.length} model(s)`;
  });

  // --- Sentiment (lightweight classifier) ---
  await check('classifier.getSentiment', async () => {
    const sentiment = await layla.classifier.getSentiment('I am delighted this task runner works.');
    const top = Object.entries(sentiment).sort((a, b) => b[1] - a[1])[0];
    return top ? `top=${top[0]} (${top[1]})` : 'no sentiment values returned';
  });

  // --- Private database round-trip ---
  await check('db.executeSql', async () => {
    await layla.db.executeSql(
      'CREATE TABLE IF NOT EXISTS diagnostics_task_runs (id INTEGER PRIMARY KEY, ran_at INTEGER)',
    );
    const insert = await layla.db.executeSql(
      'INSERT INTO diagnostics_task_runs (ran_at) VALUES (?)',
      [Date.now()],
    );
    const read = await layla.db.executeSql(
      'SELECT COUNT(*) AS n FROM diagnostics_task_runs',
    );
    const total = read.rows[0] ? read.rows[0].n : '?';
    return `insertId=${insert.insertId}, totalRuns=${total}`;
  });

  // --- Summary ---
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`Diagnostics task finished: ${passed} passed, ${failed} failed.`);

  // Resolved value — recorded as the run's output in the Task Manager.
  return {
    summary: `${passed}/${results.length} checks passed`,
    failedChecks: results.filter((r) => !r.ok).map((r) => r.name),
    results,
  };
})();
