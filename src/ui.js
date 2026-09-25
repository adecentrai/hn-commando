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

export const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
export const skin = params.get('skin') == 'r36s' || isTouch && params.get('skin') != 'off';
export const touchInput = {move: {x:0, y:0}, fire:false, jump:false, roll:false, grenade:false};

// the engine renders into the R36S screen when the skin is on
export const rootElement = skin ? $('screen') : undefined;

let handlers = {}, screenShownTime = 0;
const vibrate = (ms)=> { try { navigator.vibrate && navigator.vibrate(ms); } catch(e) {} };

if (skin)
{
    // set up the skin before the engine creates its canvas
    document.body.classList.add('skin');
    const shell = params.get('shell');
    if (shell == 'white' || shell == 'purple')
        document.body.classList.add('shell-' + shell);
    $('device').hidden = false;
    $('screen').appendChild($('screens'));
}

export function init(callbacks)
{
    handlers = callbacks;

    // keep screen and control touches away from the engine's document listeners
    for (const el of [$('screens'), $('controls'), $('device')])
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel'])
        el.addEventListener(type, e=> e.stopPropagation(), {passive: true});

    $('startBtn').addEventListener('click', ()=> handlers.onStart());
    $('againBtn').addEventListener('click', ()=> handlers.onStart());
    $('ctaBtn').addEventListener('click', ()=> handlers.onCta());

    // Enter starts or restarts, after a moment so a held key does not skip the score
    // P or Escape pauses
    addEventListener('keydown', e=>
    {
        if (e.code == 'Enter' && !$('screens').hidden && performance.now() - screenShownTime > 800)
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

    // release everything if the page loses focus mid press
    addEventListener('blur', releaseTouchInput);
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
    touchInput.move.x = touchInput.move.y = 0;
    touchInput.fire = touchInput.jump = touchInput.roll = touchInput.grenade = false;
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
            touchInput.move.x = Math.abs(dx) > .3 ? Math.sign(dx) : 0;
            touchInput.move.y = Math.abs(dy) > .55 ? -Math.sign(dy) : 0;
            if (knob)
                knob.style.transform = `translate(${dx*r.width*.25}px, ${dy*r.height*.25}px)`;
            pad.dataset.dir = (touchInput.move.y > 0 ? 'u' : touchInput.move.y < 0 ? 'd' : '') +
                (touchInput.move.x > 0 ? 'r' : touchInput.move.x < 0 ? 'l' : '');
        };
        const end = (e)=>
        {
            if (e.pointerId !== padPointer)
                return;
            padPointer = undefined;
            touchInput.move.x = touchInput.move.y = 0;
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

    // held action buttons, each tracks its own finger so they combine with the d-pad
    for (const button of document.querySelectorAll('[data-action]'))
    {
        const action = button.dataset.action;
        const knob = button.querySelector('[data-knob]');
        let pointer;
        const release = (e)=>
        {
            if (e && e.pointerId !== pointer)
                return;
            touchInput[action] = false;
            button.classList.remove('down');
            knob && (knob.style.transform = '');
        };
        button.addEventListener('pointerdown', e=>
        {
            pointer = e.pointerId;
            touchInput[action] = true;
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
                $('screens').hidden ? handlers.onPause() : handlers.onStart();
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
            if (skin && !e.target.closest('a, button'))
                handlers.onStart();
        });
}
