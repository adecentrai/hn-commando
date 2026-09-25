/*
    HN Commando - Player
    - Keyboard: arrows/WASD move, Up/W/Space jump, Z/J shoot, X/K roll, C/L grenade
    - Mouse: left shoot, middle grenade, right roll
    - Gamepad: stick move, A jump, X shoot, B grenade, Y roll
    - Touch: on-screen controls from ui.js
    - Remembers the last safe ground position to respawn there
*/

'use strict';

import * as LJS from './littlejs.esm.min.js';
import * as GameCharacter from './gameCharacter.js';
import * as UI from './ui.js';
import * as Game from './game.js';
const {vec2, hsl, Timer} = LJS;

export class Player extends GameCharacter.Character
{
    constructor(pos)
    {
        super(pos);
        this.team = 'player';
        this.color = hsl(.33,.85,.6);
        this.spawnProtection = 2;
        this.grenadeCount = Game.GRENADES_PER_LIFE;
        this.weapon.fireRate = 10;
        this.weapon.bulletRange = 9;
        this.lastSafePos = pos.copy();
        this.safePosTimer = new Timer(.5);
    }

    update()
    {
        const touch = UI.touchInput;
        const mouseMode = !UI.isTouch && !LJS.isUsingGamepad;
        const key = (...codes)=> codes.some(c=> LJS.keyIsDown(c));

        // movement control
        this.moveInput = LJS.isUsingGamepad ? LJS.gamepadStick(0) : LJS.keyDirection();
        if (touch.move.x || touch.move.y)
            this.moveInput = vec2(touch.move.x, touch.move.y);
        this.holdingJump   = key('ArrowUp', 'Space') || LJS.gamepadIsDown(0) || touch.jump;
        this.holdingShoot  = mouseMode && LJS.mouseIsDown(0) || key('KeyZ', 'KeyJ') || LJS.gamepadIsDown(2) || touch.fire;
        this.pressingThrow = mouseMode && LJS.mouseIsDown(1) || key('KeyC', 'KeyL') || LJS.gamepadIsDown(1) || touch.grenade;
        this.pressedDodge  = mouseMode && LJS.mouseIsDown(2) || key('KeyX', 'KeyK', 'ShiftLeft') || LJS.gamepadIsDown(3) || touch.roll;
        super.update();

        // remember where it was safe to stand for respawning
        if (!this.isDead() && this.groundObject && !this.climbingLadder && this.safePosTimer.elapsed())
        {
            this.lastSafePos = this.pos.copy();
            this.safePosTimer.set(.5);
        }
    }

    kill(damagingObject)
    {
        if (this.isDead())
            return;
        super.kill(damagingObject);
        Game.onPlayerDied();
    }
}
