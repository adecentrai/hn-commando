/*
    HN Commando - a retro run-and-gun for hobbyistnirvana.com
    - Clear every hostile on a random planet, then warp to the next one
    - 10 lives, +3 for each cleared mission, 3 grenades per life
    - Keyboard, mouse, gamepad or on-screen touch controls
    - Posts game events to the parent page when embedded in an iframe
    Built on the LittleJS platformer example (MIT, Frank Force)
*/

'use strict';

import * as LJS from './littlejs.esm.min.js';
import * as GameObjects from './gameObjects.js';
import * as GameEffects from './gameEffects.js';
import * as GameLevel from './gameLevel.js';
import * as GamePlayer from './gamePlayer.js';
import * as GameEnemies from './gameEnemies.js';
import * as UI from './ui.js';
const {vec2, Timer} = LJS;

export const START_LIVES = 10, LIVES_PER_MISSION = 3, GRENADES_PER_LIFE = 3, MAX_GRENADES = 6;

export let spriteAtlas, player, score = 0, lives = START_LIVES, mission = 1;
let state = 'title'; // title, playing, cleared, over
let bestScore = 0;
const stateTimer = new Timer, bannerTimer = new Timer;

export function addToScore(delta) { if (state != 'over') score += delta; }
export function onPlayerDied() { --lives; }

// report a game event to GA4 on this page, or to the Shopify page embedding it
export function track(event, params={})
{
    try { window.gtag && window.gtag('event', 'hn_commando_' + event, params); } catch(e) {}
    try { window.parent != window && window.parent.postMessage({source:'hn-commando', event, ...params}, '*'); } catch(e) {}
}

// ?debug exposes game state for automated testing
if (new URLSearchParams(location.search).has('debug'))
    window.hnDebug = {LJS, GameObjects, GameLevel,
        get state() { return {state, mission, lives, score, player, hostiles: GameObjects.hostilesAlive()}; }};

// touch devices use the DOM controls, the engine's own touch handling stays off
LJS.setTouchGamepadEnable(false);
LJS.setTouchInputEnable(!UI.isTouch);

// limit canvas aspect ratios to support most modern HD devices
LJS.setCanvasMinAspect(.4);
LJS.setCanvasMaxAspect(2.5);

///////////////////////////////////////////////////////////////////////////////

function loadMission()
{
    GameObjects.hostiles.length = 0;
    const spawns = GameLevel.buildLevel(mission);
    for (const pos of spawns.crates)
        new GameObjects.Crate(pos);
    for (const pos of spawns.coins)
        new GameObjects.Coin(pos);
    for (const hostile of spawns.hostiles)
        GameEnemies.spawnHostile(hostile.type, hostile.pos);

    player = new GamePlayer.Player(GameLevel.playerStartPos);
    LJS.setCameraPos(GameLevel.getCameraTarget());
    bannerTimer.set(3);
}

function startGame()
{
    LJS.audioContext && LJS.audioContext.resume();
    score = 0;
    lives = START_LIVES;
    mission = 1;
    loadMission();
    state = 'playing';
    UI.hideScreens();
    LJS.setPaused(false);
    track('start');
}

function respawn()
{
    const pos = GameLevel.findSafeSpawn(player.lastSafePos);
    player = new GamePlayer.Player(pos);
    player.velocity = vec2(0,.1);
    GameEffects.sound_spawn.play(pos);
}

function gameOver()
{
    state = 'over';
    bestScore = LJS.max(bestScore, score);
    try { localStorage.setItem('hnCommandoBest', bestScore); } catch(e) {}
    track('game_over', {score, mission});
    UI.showGameOver({score, mission, best: bestScore});
    LJS.setPaused(true);
}

///////////////////////////////////////////////////////////////////////////////

async function gameInit()
{
    // engine settings
    LJS.setGravity(vec2(0,-.01));
    LJS.setObjectDefaultDamping(.99);
    LJS.setObjectDefaultAngleDamping(.99);

    // create a table of all sprites
    const gameTile = (i, size=16)=> LJS.tile(i, size, 0, 1);
    spriteAtlas =
    {
        // large tiles
        circle:  gameTile(0),
        crate:   gameTile(1),
        player:  gameTile(2),
        enemy:   gameTile(4),
        coin:    gameTile(5),
        turret:  gameTile(6),

        // small tiles
        gun:     gameTile(vec2(0,2),8),
        grenade: gameTile(vec2(1,2),8),
    };

    try { bestScore = +localStorage.getItem('hnCommandoBest') || 0; } catch(e) {}
    UI.init({onStart: startGame, onCta: ()=> track('cta_click', {score, mission})});

    // a live planet sits behind the title screen
    loadMission();
    LJS.setPaused(true);
    UI.showTitle();
}

///////////////////////////////////////////////////////////////////////////////

function gameUpdate()
{
    if (state == 'playing')
    {
        if (player.isDead())
        {
            if (player.deadTimer > 1.5)
                lives > 0 ? respawn() : gameOver();
        }
        else if (!GameObjects.hostilesAlive())
        {
            // mission cleared, player can't be hurt while warping out
            state = 'cleared';
            stateTimer.set(3);
            lives += LIVES_PER_MISSION;
            addToScore(500*mission);
            player.spawnProtection = 1e9;
            GameEffects.sound_mission.play();
            track('mission_clear', {mission, score});
        }
    }
    else if (state == 'cleared' && stateTimer.elapsed())
    {
        ++mission;
        loadMission();
        state = 'playing';
    }
}

///////////////////////////////////////////////////////////////////////////////

function gameUpdatePost()
{
    if (!player)
        return;

    // follow the player, keeping the view inside the level walls and above bedrock
    const target = GameLevel.getCameraTarget();
    let pos = LJS.cameraPos.lerp(target, LJS.clamp(player.getAliveTime()/2));
    const half = LJS.getCameraSize().scale(.5), size = GameLevel.levelSize;
    pos = vec2(
        size.x > 2*half.x ? LJS.clamp(pos.x, half.x, size.x - half.x) : size.x/2,
        LJS.max(pos.y, half.y - 1));
    LJS.setCameraPos(pos);
}

///////////////////////////////////////////////////////////////////////////////

function gameRender()
{
    // zoom so roughly 18 tiles fit across, or 11 tiles tall on wide screens
    const s = LJS.mainCanvasSize;
    LJS.setCameraScale(LJS.clamp(LJS.min(s.x/18, s.y/11), 20, 72));
}

///////////////////////////////////////////////////////////////////////////////

function gameRenderPost()
{
    if (state == 'title')
        return;

    const context = LJS.mainContext;
    const W = LJS.mainCanvasSize.x, H = LJS.mainCanvasSize.y;
    const u = LJS.clamp(LJS.min(W, H)/20, 13, 28); // hud unit
    const pad = u*.6;
    const drawText = (text, x, y, size, align='left', color='#fff')=>
    {
        context.textAlign = align;
        context.textBaseline = 'top';
        context.font = `bold ${size}px "Courier New", monospace`;
        context.lineWidth = LJS.max(2, size/5);
        context.strokeStyle = '#000';
        context.fillStyle = color;
        context.strokeText(text, x, y);
        context.fillText(text, x, y);
    };

    // status
    const hostilesLeft = GameObjects.hostilesAlive();
    drawText(`MISSION ${mission}`, pad, pad, u);
    drawText(score.toLocaleString('en-IN'), W-pad, pad, u, 'right', '#e2b96f');
    drawText(`♥${lives}  💣${player ? player.grenadeCount : 0}`, pad, pad + u*1.3, u*.85);
    drawText(`HOSTILES ${hostilesLeft}`, W-pad, pad + u*1.3, u*.85, 'right', '#ff8fb0');

    // radar: centred between the status text on wide screens, below it on narrow ones
    const wide = W > u*34;
    const radarW = wide ? W - u*26 : W - 2*pad;
    drawRadar(context, (W - radarW)/2, wide ? pad : pad + u*2.6, radarW, u*1.6);

    // banners
    const banner = (title, subtitle)=>
    {
        drawText(title, W/2, H*.3, u*2, 'center', '#e2b96f');
        drawText(subtitle, W/2, H*.3 + u*2.4, u, 'center');
    };
    if (state == 'cleared')
        banner('MISSION COMPLETE', `+${LIVES_PER_MISSION} LIVES · WARPING TO NEXT PLANET`);
    else if (bannerTimer.active() && state == 'playing')
        banner(`MISSION ${mission}`, `ELIMINATE ALL ${hostilesLeft} HOSTILES`);
    else if (state == 'playing' && player && player.isDead() && lives > 0)
        banner(`${lives} ${lives == 1 ? 'LIFE' : 'LIVES'} LEFT`, 'REDEPLOYING...');
}

function drawRadar(context, x, y, w, h)
{
    const size = GameLevel.levelSize;
    const toRadar = (p)=> vec2(x + p.x/size.x*w, y + h - p.y/size.y*h);

    context.fillStyle = 'rgba(0,0,0,.5)';
    context.fillRect(x, y, w, h);
    context.lineWidth = 1;
    context.strokeStyle = 'rgba(226,185,111,.7)';
    context.strokeRect(x+.5, y+.5, w-1, h-1);

    // current view
    const half = LJS.getCameraSize().scale(.5);
    const a = toRadar(LJS.cameraPos.subtract(half)), b = toRadar(LJS.cameraPos.add(half));
    context.strokeStyle = 'rgba(255,255,255,.35)';
    context.strokeRect(a.x, y+1, b.x - a.x, h-2);

    // hostiles blink red, the player is green
    const dot = LJS.max(2, h/7);
    context.fillStyle = (LJS.time*4|0)%2 ? '#ff3b5c' : '#ff8fb0';
    for (const o of GameObjects.hostiles)
    {
        if (o.destroyed || o.isDead())
            continue;
        const p = toRadar(o.pos);
        context.fillRect(p.x - dot/2, p.y - dot/2, dot, dot);
    }
    if (player && !player.isDead())
    {
        const p = toRadar(player.pos);
        context.fillStyle = '#5f5';
        context.fillRect(p.x - dot, p.y - dot, dot*2, dot*2);
    }
}

///////////////////////////////////////////////////////////////////////////////
// Startup LittleJS Engine
LJS.engineInit(gameInit, gameUpdate, gameUpdatePost, gameRender, gameRenderPost, ['assets/tiles.png', 'assets/tilesLevel.png']);
