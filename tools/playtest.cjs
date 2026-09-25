// Headless playtest for HN Commando: node tools/playtest.cjs [baseUrl] [outDir]
// Serves nothing itself, point it at a running server (python -m http.server 8765).
const {chromium} = require('playwright');
const path = require('path');

const base = process.argv[2] || 'http://127.0.0.1:8765/';
const out = process.argv[3] || path.join(__dirname, '..', 'test-output');
const shot = (page, name)=> page.screenshot({path: path.join(out, name + '.png')});
const wait = (page, ms)=> page.waitForTimeout(ms);
const state = (page)=> page.evaluate(()=>
{
    const s = hnDebug.state, p = s.player;
    return {state: s.state, mission: s.mission, lives: s.lives, score: s.score, hostiles: s.hostiles,
        pos: p && [+p.pos.x.toFixed(1), +p.pos.y.toFixed(1)], dead: p && p.isDead(), grenades: p && p.grenadeCount,
        time: +hnDebug.LJS.time.toFixed(1)};
});

async function run()
{
    require('fs').mkdirSync(out, {recursive: true});
    const browser = await chromium.launch({args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
    const errors = [];
    const watch = (page, label)=>
    {
        page.on('pageerror', e=> errors.push(`${label} pageerror: ${e.message}`));
        page.on('console', m=> m.type() == 'error' && !m.text().includes('favicon') && errors.push(`${label} console: ${m.text()}`));
    };
    const report = {};

    // --- desktop: level generator across missions
    {
        const page = await browser.newPage({viewport: {width: 1280, height: 720}});
        watch(page, 'gen');
        await page.goto(base + '?debug');
        await wait(page, 1200);
        report.generator = await page.evaluate(()=>
        {
            const rows = [];
            for (let m = 1; m <= 12; ++m)
            for (let run = 0; run < 3; ++run)
            {
                const spawns = hnDebug.GameLevel.buildLevel(m);
                const types = {};
                for (const h of spawns.hostiles)
                    types[h.type] = (types[h.type] || 0) + 1;
                const LJS = hnDebug.LJS, start = spawns.start;
                const startClear = LJS.tileCollisionGetData(start) <= 0 && LJS.tileCollisionGetData(start.add(LJS.vec2(0,1))) <= 0;
                const startGround = LJS.tileCollisionGetData(start.subtract(LJS.vec2(0,1))) > 0;
                const blocked = spawns.hostiles.filter(h=> LJS.tileCollisionGetData(h.pos) > 0).length;
                rows.push({m, size: hnDebug.GameLevel.levelSize.x, hostiles: spawns.hostiles.length, types,
                    coins: spawns.coins.length, crates: spawns.crates.length, startClear, startGround, blocked});
            }
            return rows;
        });
        await page.close();
    }

    // --- desktop: play, clear a mission, lose all lives
    {
        const page = await browser.newPage({viewport: {width: 1280, height: 720}});
        watch(page, 'desktop');
        await page.goto(base + '?debug');
        await wait(page, 1200);
        await shot(page, 'd1-title');
        await page.click('#startBtn');
        await wait(page, 600);
        report.start = await state(page);
        await shot(page, 'd2-start');

        // run right shooting, then throw a grenade
        await page.keyboard.down('ArrowRight');
        await page.keyboard.down('z');
        await wait(page, 3000);
        await shot(page, 'd3-run-shoot');
        await page.keyboard.up('z');
        await page.keyboard.press('c');
        await wait(page, 1200);
        await shot(page, 'd4-grenade');
        await page.keyboard.up('ArrowRight');
        await wait(page, 2500);
        report.afterRun = await state(page);

        // clear the mission through the real damage path and watch the warp to mission 2
        await page.evaluate(()=> { for (const h of hnDebug.GameObjects.hostiles) h.destroyed || h.isDead() || h.damage(999); });
        await wait(page, 400);
        report.cleared = await state(page);
        await shot(page, 'd5-cleared');
        await wait(page, 3500);
        report.mission2 = await state(page);
        await shot(page, 'd6-mission2');

        // finish turrets off the way a last bullet does (their death blast must not re-kill them)
        report.turretKill = await page.evaluate(()=>
        {
            const turrets = hnDebug.GameObjects.hostiles.filter(h=> h.constructor.name == 'Turret' && !h.destroyed);
            let error = '';
            try { for (const t of turrets) { t.health = 1; t.damage(1); } } catch(e) { error = e.message; }
            return {turrets: turrets.length, destroyed: turrets.filter(t=> t.destroyed).length, error};
        });
        const t0 = (await state(page)).time;
        await wait(page, 1000);
        report.turretKill.timeAdvances = (await state(page)).time > t0;

        // a turret's death blast spares a player standing right next to it
        report.turretBlastSparesPlayer = await page.evaluate(()=>
        {
            const p = hnDebug.state.player, LJS = hnDebug.LJS;
            p.spawnProtection = 0;
            hnDebug.GameLevel.foregroundTileLayer; // level is live
            const t = hnDebug.spawnHostile('turret', p.pos.add(LJS.vec2(1, 0)));
            t.health = 1; t.damage(1);
            return !p.isDead();
        });

        // a grenade blast carves terrain through the batched redraw, with no errors
        report.grenadeCarves = await page.evaluate(()=>
        {
            const LJS = hnDebug.LJS, p = hnDebug.state.player;
            const below = p.pos.add(LJS.vec2(3, -2)).floor();
            const before = LJS.tileCollisionGetData(below);
            hnDebug.explosion(below.add(LJS.vec2(.5)), 3);
            return {before, after: LJS.tileCollisionGetData(below)};
        });
        await wait(page, 600);
        await shot(page, 'd6b-grenade-carve');

        // clearing the last hostile in the same moment the player dies still clears the mission
        report.clearWhileDying = await page.evaluate(async ()=>
        {
            const livesBefore = hnDebug.state.lives;
            const p = hnDebug.state.player; p.spawnProtection = 0; p.kill();
            for (const h of hnDebug.GameObjects.hostiles) h.destroyed || h.isDead() || h.damage(999);
            await new Promise(r=> setTimeout(r, 400));
            return {livesBefore, state: hnDebug.state.state, lives: hnDebug.state.lives};
        });
        await wait(page, 3500);
        report.afterClearWhileDying = await state(page);

        // die until the game ends
        for (let i = 0; i < 60; ++i)
        {
            const s = await state(page);
            if (s.state == 'over') break;
            if (!s.dead)
                await page.evaluate(()=> { const p = hnDebug.state.player; p.spawnProtection = 0; p.kill(); });
            await wait(page, 1700);
        }
        report.over = await state(page);
        report.overScreen = await page.evaluate(()=> ({
            visible: !document.getElementById('gameover').hidden,
            score: document.getElementById('goScore').textContent,
            cta: document.getElementById('ctaBtn').href}));
        await shot(page, 'd7-gameover');

        // play again
        await page.click('#againBtn');
        await wait(page, 500);
        report.again = await state(page);
        await page.close();
    }

    // --- phone portrait and landscape with touch controls
    // R36S skin (default on phones) in both orientations, plus the plain overlay controls
    const phones = [
        ['r36s-portrait', {width: 390, height: 844}, '', '#dpadCross', '.face.b', '[data-command=start]'],
        ['r36s-landscape', {width: 844, height: 390}, '', '#dpadCross', '.face.b', '[data-command=start]'],
        ['r36s-purple', {width: 360, height: 740}, '&shell=purple', '.stick[data-move]', '.stick[data-action]', '[data-command=start]'],
        ['plain-portrait', {width: 390, height: 844}, '&skin=off', '#dpad', '.tbtn.fire', '#startBtn'],
    ];
    for (const [label, viewport, query, padSel, fireSel, startSel] of phones)
    {
        const context = await browser.newContext({viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 2});
        const page = await context.newPage();
        watch(page, label);
        await page.goto(base + '?debug' + query);
        await wait(page, 1200);
        await shot(page, `m-${label}-1-title`);
        await page.tap(startSel);
        await wait(page, 600);
        const started = (await state(page)).state;

        // hold the d-pad right and fire with two real touch points
        const cdp = await context.newCDPSession(page);
        const center = (sel)=> page.evaluate((sel)=>
        {
            const r = document.querySelector(sel).getBoundingClientRect();
            return {x: r.left + r.width/2, y: r.top + r.height/2, w: r.width};
        }, sel);
        const pad = await center(padSel), fire = await center(fireSel);
        const padPoint = {x: pad.x + pad.w*.4, y: pad.y, id: 1}, firePoint = {x: fire.x, y: fire.y, id: 2};
        const before = await state(page);
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [padPoint]});
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [padPoint, firePoint]});
        await wait(page, 1500);
        await shot(page, `m-${label}-2-touch`);
        const fireDown = await page.evaluate((sel)=> document.querySelector(sel).classList.contains('down'), fireSel);
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
        await wait(page, 300);
        const after = await state(page);
        const released = await page.evaluate(()=> !document.querySelector('.down'));

        // START pauses and resumes during play on the skin
        let pause, slide, selectToast;
        if (startSel != '#startBtn')
        {
            // a thumb sliding from B onto A hands the press over: fire stops, jump starts
            const b = await center('.face.b'), a = await center('.face.a');
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: b.x, y: b.y, id: 3}]});
            await wait(page, 150);
            const onB = await page.evaluate(()=> [document.querySelector('.face.b').classList.contains('down'), document.querySelector('.face.a').classList.contains('down')]);
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: a.x, y: a.y, id: 3}]});
            await wait(page, 150);
            const onA = await page.evaluate(()=> [document.querySelector('.face.b').classList.contains('down'), document.querySelector('.face.a').classList.contains('down')]);
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
            await wait(page, 150);
            slide = {onB, onA, released: await page.evaluate(()=> !document.querySelector('.face.down'))};

            // SELECT shows its message
            await page.tap('[data-command=select]');
            await wait(page, 200);
            selectToast = await page.evaluate(()=> !document.getElementById('toast').hidden && document.getElementById('toast').textContent);
            await page.tap('[data-command=select]');

            await page.tap(startSel);
            await wait(page, 300);
            const t0 = (await state(page)).time;
            await wait(page, 600);
            const paused = (await state(page)).time == t0;
            await shot(page, `m-${label}-3-paused`);
            await page.tap(startSel);
            await wait(page, 400);
            pause = {paused, resumed: (await state(page)).time > t0};
        }
        report[label] = {started, before: before.pos, after: after.pos, fireDown, released, pause, slide, selectToast};
        await context.close();
    }

    await browser.close();
    report.errors = errors;
    console.log(JSON.stringify(report, null, 1));
}

run().catch(e=> { console.error(e.message.split('\n')[0]); process.exit(1); });
