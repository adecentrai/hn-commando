/*
    HN Commando - DOM user interface
    - Title and game over screens are HTML so buttons and links work on every device
    - Labelled on-screen touch controls: a d-pad plus FIRE, JUMP, ROLL and GRENADE
    - Touches on the UI never reach the engine
*/

'use strict';

export const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
export const touchInput = {move: {x:0, y:0}, fire:false, jump:false, roll:false, grenade:false};

const $ = (id)=> document.getElementById(id);
let handlers = {}, screenShownTime = 0;

export function init(callbacks)
{
    handlers = callbacks;

    // keep screen and control touches away from the engine's document listeners
    for (const el of [$('screens'), $('controls')])
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel'])
        el.addEventListener(type, e=> e.stopPropagation(), {passive: true});

    $('startBtn').addEventListener('click', ()=> handlers.onStart());
    $('againBtn').addEventListener('click', ()=> handlers.onStart());
    $('ctaBtn').addEventListener('click', ()=> handlers.onCta());

    // Enter starts or restarts, after a moment so a held key does not skip the score
    addEventListener('keydown', e=>
    {
        if (e.code != 'Enter' || $('screens').hidden || performance.now() - screenShownTime < 800)
            return;
        handlers.onStart();
    });

    $('controlsHint').textContent = isTouch ?
        'Left pad moves and climbs. Right buttons: FIRE, JUMP, ROLL, GRENADE.' :
        'Arrows or WASD move · Up/Space jump · Z shoot · X roll · C grenade';

    if (isTouch)
    {
        document.body.classList.add('touch');
        initTouchControls();
    }

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
    $('controls').hidden = !!id || !isTouch;
    screenShownTime = performance.now();
    releaseTouchInput();
}

function releaseTouchInput()
{
    touchInput.move.x = touchInput.move.y = 0;
    touchInput.fire = touchInput.jump = touchInput.roll = touchInput.grenade = false;
    for (const el of document.querySelectorAll('.tbtn.down'))
        el.classList.remove('down');
    $('dpadKnob').style.transform = '';
}

function initTouchControls()
{
    // d-pad: 8 way, drag the thumb around without lifting it
    const pad = $('dpad'), knob = $('dpadKnob');
    let padPointer;
    const updatePad = (e)=>
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
        knob.style.transform = `translate(${dx*r.width*.3}px, ${dy*r.height*.3}px)`;
    };
    const endPad = (e)=>
    {
        if (e.pointerId !== padPointer)
            return;
        padPointer = undefined;
        touchInput.move.x = touchInput.move.y = 0;
        knob.style.transform = '';
    };
    pad.addEventListener('pointerdown', e=>
    {
        padPointer = e.pointerId;
        pad.setPointerCapture(e.pointerId);
        updatePad(e);
        e.preventDefault();
    });
    pad.addEventListener('pointermove', e=> e.pointerId === padPointer && updatePad(e));
    pad.addEventListener('pointerup', endPad);
    pad.addEventListener('pointercancel', endPad);
    pad.addEventListener('lostpointercapture', endPad);

    // action buttons, each tracks its own finger so they combine with the d-pad
    for (const button of document.querySelectorAll('.tbtn'))
    {
        const action = button.dataset.action;
        const release = ()=>
        {
            touchInput[action] = false;
            button.classList.remove('down');
        };
        button.addEventListener('pointerdown', e=>
        {
            touchInput[action] = true;
            button.classList.add('down');
            button.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        button.addEventListener('pointerup', release);
        button.addEventListener('pointercancel', release);
        button.addEventListener('lostpointercapture', release);
        button.addEventListener('contextmenu', e=> e.preventDefault());
    }
}
