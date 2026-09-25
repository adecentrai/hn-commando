/*
    HN Commando - DOM user interface
    - Title and game over screens are HTML so buttons and links work on every device
    - Phones get an R36S handheld skin: the game runs on its 4:3 screen and its
      D-pad, sticks, ABXY, START, SELECT and FN are the controls
    - ?skin=off falls back to plain overlay buttons, ?skin=r36s forces the skin on desktop
    - ?shell=white or ?shell=purple picks the other R36S shell colours
    - Touches on the UI never reach the engine
*/

'use strict';

const $ = (id)=> document.getElementById(id);
const params = new URLSearchParams(location.search);

// a touchscreen laptop still has a fine pointer, so it keeps the desktop controls
export const isTouch = matchMedia('(pointer: coarse)').matches;
export const skin = params.get('skin') == 'r36s' || isTouch && params.get('skin') != 'off';
export const touchInput = {move: {x:0, y:0}, fire:false, jump:false, roll:false, grenade:false};

// the engine renders into the R36S screen when the skin is on
export const rootElement = skin ? $('screen') : undefined;

let handlers = {}, screenShownTime = 0, toastTimer;
const screenIsReady = ()=> performance.now() - screenShownTime > 800;
const vibrate = (ms)=> { try { navigator.vibrate && navigator.vibrate(ms); } catch(e) {} };

// several controls can drive the same input (d-pad and left stick, B and right stick),
// so each keeps its own state and the inputs combine them
const moveSources = new Map, actionSources = {fire: new Set, jump: new Set, roll: new Set, grenade: new Set};
function setMove(source, x, y)
{
    x || y ? moveSources.set(source, {x, y}) : moveSources.delete(source);
    let mx = 0, my = 0;
    for (const m of moveSources.values())
        mx += m.x, my += m.y;
    touchInput.move.x = Math.sign(mx);
    touchInput.move.y = Math.sign(my);
}
function setAction(action, source, down)
{
    down ? actionSources[action].add(source) : actionSources[action].delete(source);
    touchInput[action] = actionSources[action].size > 0;
}

if (skin)
{
    // set up the skin before the engine creates its canvas
    document.body.classList.add('skin');
    const shell = params.get('shell');
    if (shell == 'white' || shell == 'purple')
        document.body.classList.add('shell-' + shell);
    $('device').hidden = false;
    $('screen').appendChild($('screens'));
    $('screen').appendChild($('toast'));

    // screen-relative sizing unit, works on browsers without container query units
    const screen = $('screen');
    const setUnit = ()=> screen.style.setProperty('--cq', screen.clientWidth/100 + 'px');
    setUnit();
    if (window.ResizeObserver)
        new ResizeObserver(setUnit).observe(screen);
    else
        addEventListener('resize', setUnit);
}

export function init(callbacks)
{
    handlers = callbacks;

    // keep screen and control touches away from the engine's document listeners
    for (const el of [$('screens'), $('controls'), $('device')])
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel'])
        el.addEventListener(type, e=> e.stopPropagation(), {passive: true});

    // stop pinch zoom on iOS when two thumbs move at once
    document.addEventListener('gesturestart', e=> e.preventDefault());

    $('startBtn').addEventListener('click', ()=> handlers.onStart());
    $('againBtn').addEventListener('click', ()=> handlers.onStart());
    $('ctaBtn').addEventListener('click', ()=> handlers.onCta());

    // Enter starts or restarts, after a moment so a held key does not skip the score
    // P or Escape pauses
    addEventListener('keydown', e=>
    {
        if (e.code == 'Enter' && !$('screens').hidden && screenIsReady())
            handlers.onStart();
        else if ((e.code == 'KeyP' || e.code == 'Escape') && $('screens').hidden)
            handlers.onPause();
    });

    $('controlsHint').textContent = skin ? 'B fire · A jump · Y grenade · X roll' :
        isTouch ? 'Left pad moves and climbs. Right buttons: FIRE, JUMP, ROLL, GRENADE.' :
        'Arrows or WASD move · Up/Space jump · Z shoot · X roll · C grenade · P pause';

    if (isTouch)
        document.body.classList.add('touch');
    if (isTouch || skin)
        initControls();

    // release everything if the page loses focus or is hidden mid press
    addEventListener('blur', releaseTouchInput);
    addEventListener('pagehide', releaseTouchInput);
    document.addEventListener('visibilitychange', ()=> document.hidden && releaseTouchInput());
}

export function showTitle() { show('title'); }
export function hideScreens() { show(''); }
export function showGameOver({score, mission, best})
{
    $('goScore').textContent = score.toLocaleString('en-IN');
    $('goMission').textContent = mission;
    $('goBest').textContent = best.toLocaleString('en-IN');
    show('gameover');
}

// short message over the game, shown on every screen
export function toast(text, ms=1500)
{
    const el = $('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=> el.hidden = true, ms);
}

function show(id)
{
    for (const screen of document.querySelectorAll('.screen'))
        screen.hidden = screen.id != id;
    $('screens').hidden = !id;
    $('controls').hidden = !!id || !isTouch || skin;
    screenShownTime = performance.now();
    releaseTouchInput();
}

function releaseTouchInput()
{
    moveSources.clear();
    touchInput.move.x = touchInput.move.y = 0;
    for (const action in actionSources)
    {
        actionSources[action].clear();
        touchInput[action] = false;
    }
    for (const el of document.querySelectorAll('.down'))
        el.classList.remove('down');
    for (const el of document.querySelectorAll('[data-knob]'))
        el.style.transform = '';
    $('dpadCross').dataset.dir = '';
}

function initControls()
{
    // directional controls (d-pads and the left stick): 8 way, drag without lifting
    for (const pad of document.querySelectorAll('[data-move]'))
    {
        const knob = pad.querySelector('[data-knob]');
        let padPointer;
        const update = (e)=>
        {
            const r = pad.getBoundingClientRect();
            let dx = (e.clientX - r.left - r.width/2) / (r.width/2);
            let dy = (e.clientY - r.top - r.height/2) / (r.height/2);
            const length = Math.hypot(dx, dy);
            if (length > 1)
                dx /= length, dy /= length;

            // up and down need a firmer push so running does not grab ladders
            const x = Math.abs(dx) > .3 ? Math.sign(dx) : 0;
            const y = Math.abs(dy) > .55 ? -Math.sign(dy) : 0;
            setMove(pad, x, y);
            if (knob)
                knob.style.transform = `translate(${dx*r.width*.25}px, ${dy*r.height*.25}px)`;
            pad.dataset.dir = (y > 0 ? 'u' : y < 0 ? 'd' : '') + (x > 0 ? 'r' : x < 0 ? 'l' : '');
        };
        const end = (e)=>
        {
            if (e.pointerId !== padPointer)
                return;
            padPointer = undefined;
            setMove(pad, 0, 0);
            knob && (knob.style.transform = '');
            pad.dataset.dir = '';
        };
        pad.addEventListener('pointerdown', e=>
        {
            padPointer = e.pointerId;
            pad.setPointerCapture(e.pointerId);
            update(e);
            e.preventDefault();
        });
        pad.addEventListener('pointermove', e=> e.pointerId === padPointer && update(e));
        pad.addEventListener('pointerup', end);
        pad.addEventListener('pointercancel', end);
        pad.addEventListener('lostpointercapture', end);
    }

    // ABXY: a thumb can slide from one face button to the next, like on the real pad
    const abxy = $('abxy');
    const faceFingers = new Map; // pointerId -> face button under that finger
    const faceAt = (e)=>
    {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        return el && el.closest && abxy.contains(el) ? el.closest('.face') : null;
    };
    const setFace = (pointerId, face)=>
    {
        const old = faceFingers.get(pointerId);
        if (old == face)
            return;
        if (old)
        {
            setAction(old.dataset.action, pointerId, false);
            [...faceFingers.values()].filter(f=> f == old).length == 1 && old.classList.remove('down');
        }
        face ? faceFingers.set(pointerId, face) : faceFingers.delete(pointerId);
        if (face)
        {
            setAction(face.dataset.action, pointerId, true);
            face.classList.add('down');
            vibrate(10);
        }
    };
    abxy.addEventListener('pointerdown', e=>
    {
        const face = faceAt(e);
        if (!face)
            return;
        abxy.setPointerCapture(e.pointerId);
        setFace(e.pointerId, face);
        e.preventDefault();
    });
    abxy.addEventListener('pointermove', e=> faceFingers.has(e.pointerId) && setFace(e.pointerId, faceAt(e) || faceFingers.get(e.pointerId)));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
        abxy.addEventListener(type, e=> setFace(e.pointerId, null));
    abxy.addEventListener('contextmenu', e=> e.preventDefault());

    // other held buttons (right stick, plain overlay buttons), each tracks its own finger
    for (const button of document.querySelectorAll('[data-action]:not(.face)'))
    {
        const action = button.dataset.action;
        const knob = button.querySelector('[data-knob]');
        let pointer;
        const release = (e)=>
        {
            if (e.pointerId !== pointer)
                return;
            pointer = undefined;
            setAction(action, button, false);
            button.classList.remove('down');
            knob && (knob.style.transform = '');
        };
        button.addEventListener('pointerdown', e=>
        {
            pointer = e.pointerId;
            setAction(action, button, true);
            button.classList.add('down');
            button.setPointerCapture(e.pointerId);
            skin && vibrate(10);
            e.preventDefault();
        });
        button.addEventListener('pointermove', e=>
        {
            // the right stick wiggles while held
            if (knob && e.pointerId === pointer)
            {
                const r = button.getBoundingClientRect();
                const dx = Math.max(-1, Math.min(1, (e.clientX - r.left - r.width/2) / (r.width/2)));
                const dy = Math.max(-1, Math.min(1, (e.clientY - r.top - r.height/2) / (r.height/2)));
                knob.style.transform = `translate(${dx*r.width*.25}px, ${dy*r.height*.25}px)`;
            }
        });
        button.addEventListener('pointerup', release);
        button.addEventListener('pointercancel', release);
        button.addEventListener('lostpointercapture', release);
        button.addEventListener('contextmenu', e=> e.preventDefault());
    }

    // system buttons fire once per press
    for (const button of document.querySelectorAll('[data-command]'))
    {
        const command = button.dataset.command;
        button.addEventListener('pointerdown', e=>
        {
            button.classList.add('down');
            skin && vibrate(15);
            e.preventDefault();
            if (command == 'start')
                $('screens').hidden ? handlers.onPause() : screenIsReady() && handlers.onStart();
            else if (command == 'select')
                handlers.onSelect();
            else if (command == 'fn')
                handlers.onFn();
        });
        for (const type of ['pointerup', 'pointercancel', 'pointerleave'])
            button.addEventListener(type, ()=> button.classList.remove('down'));
        button.addEventListener('contextmenu', e=> e.preventDefault());
    }

    // tapping the title or game over screen text also starts, like pressing START
    for (const id of ['title', 'gameover'])
        $(id).addEventListener('click', e=>
        {
            if (skin && !e.target.closest('a, button') && screenIsReady())
                handlers.onStart();
        });
}
