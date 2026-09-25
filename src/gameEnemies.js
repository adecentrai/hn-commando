/*
    HN Commando - Hostiles
    - Hopper: blob that bounces toward the player and hurts on touch
    - Soldier: alien trooper that patrols, spots the player and fires bursts
    - Turret: fixed gun that aims at the player through open lines of sight
    Every hostile registers in GameObjects.hostiles for the mission counter
*/

'use strict';

import * as LJS from './littlejs.esm.min.js';
import * as GameObjects from './gameObjects.js';
import * as GameCharacter from './gameCharacter.js';
import * as GameEffects from './gameEffects.js';
import * as Game from './game.js';
const {vec2, hsl, Timer} = LJS;

const alienGoo = hsl(.3,1,.45);

// true if nothing solid blocks the straight line between two points
const canSee = (a, b)=> !LJS.tileCollisionRaycast(a, b);

export function spawnHostile(type, pos)
{
    if (type == 'soldier') return new Soldier(pos);
    if (type == 'turret')  return new Turret(pos);
    return new Hopper(pos);
}

///////////////////////////////////////////////////////////////////////////////

export class Hopper extends GameObjects.GameObject
{
    constructor(pos)
    {
        super(pos, vec2(.9,.9), Game.spriteAtlas.enemy);

        this.team = 'enemy';
        this.drawSize = vec2(1);
        this.color = hsl(LJS.rand(.7,.95), 1, .65);
        this.health = 3;
        this.bounceTime = new Timer(LJS.rand(1e3));
        this.setCollision(true, false);
        GameObjects.hostiles.push(this);
    }

    update()
    {
        super.update();

        const player = Game.player;
        if (!player || player.isDead())
            return;

        // hop around, leaning toward the player when close
        const toPlayer = player.pos.x - this.pos.x;
        if (this.groundObject && LJS.rand() < .015 && LJS.abs(toPlayer) < 16)
        {
            const lean = LJS.abs(toPlayer) < 10 ? LJS.sign(toPlayer)*.06 : 0;
            this.velocity = vec2(LJS.rand(.08,-.08) + lean, LJS.rand(.35,.2));
        }

        // damage player if touching
        if (this.isOverlappingObject(player))
            player.damage(1, this);
    }

    kill()
    {
        if (this.destroyed)
            return;

        Game.addToScore(100);
        GameEffects.sound_score.play(this.pos);
        GameEffects.makeDebris(this.pos, this.color);
        this.destroy();
    }

    render()
    {
        // bounce by changing size
        const bounceTime = this.bounceTime*6;
        this.drawSize = vec2(1-.1*LJS.sin(bounceTime), 1+.1*LJS.sin(bounceTime));

        // make bottom flush
        let bodyPos = this.pos;
        bodyPos = bodyPos.add(vec2(0,(this.drawSize.y-this.size.y)/2));
        LJS.drawTile(bodyPos, this.drawSize, this.tileInfo, this.color, this.angle, this.mirror, this.additiveColor);
    }
}

///////////////////////////////////////////////////////////////////////////////

export class Soldier extends GameCharacter.Character
{
    constructor(pos)
    {
        super(pos);

        this.team = 'enemy';
        this.color = hsl(LJS.rand(.78,.9), .9, .6);
        this.bloodColor = alienGoo;
        this.health = Game.mission > 3 ? 3 : 2;
        this.maxSpeed = .07;
        this.spawnProtection = 0;
        this.grenadeCount = 0;
        this.patrolDir = LJS.randSign();
        this.mirror = this.patrolDir < 0;
        this.idleTimer = new Timer;
        this.thinkTimer = new Timer(LJS.rand(1,3));
        this.reactTimer = new Timer;
        this.burstPhase = LJS.rand(9);

        this.weapon.fireRate = 3 + LJS.min(Game.mission, 5)*.4;
        this.weapon.bulletSpeed = .22;
        this.weapon.bulletSpread = .06;
        this.weapon.bulletRange = 11;
        this.weapon.bulletColor = hsl(.9,1,.6);
        this.weapon.fireSound = GameEffects.sound_enemyShoot;
        GameObjects.hostiles.push(this);
    }

    update()
    {
        this.moveInput = vec2();
        this.holdingShoot = this.holdingJump = false;
        if (this.isDead())
            return super.update();

        const player = Game.player;
        const toPlayer = player ? player.pos.subtract(this.pos) : vec2(99);
        const spotted = player && !player.isDead()
            && LJS.abs(toPlayer.x) < 13 && LJS.abs(toPlayer.y) < 4
            && canSee(this.pos, player.pos);

        if (spotted)
        {
            // face the player and fire in bursts after a short reaction time
            this.mirror = toPlayer.x < 0;
            if (!this.reactTimer.isSet())
                this.reactTimer.set(LJS.rand(.35,.8));
            if (this.reactTimer.elapsed())
                this.holdingShoot = (LJS.time + this.burstPhase) % 1.6 < .5;

            // close in when far, jump when the player is above
            if (LJS.abs(toPlayer.x) > 8)
                this.moveInput.x = LJS.sign(toPlayer.x);
            if (toPlayer.y > 2 && LJS.rand() < .01)
                this.holdingJump = true;
        }
        else
        {
            this.reactTimer.unset();

            // patrol, pausing now and then
            if (this.thinkTimer.elapsed())
            {
                this.thinkTimer.set(LJS.rand(2,4));
                if (LJS.rand() < .35)
                    this.idleTimer.set(LJS.rand(.5,1.5));
            }
            if (!this.idleTimer.active())
            {
                // turn around at walls and ledges
                const ahead = this.pos.add(vec2(this.patrolDir*.7, 0));
                const wallAhead = LJS.tileCollisionGetData(ahead) > 0;
                const groundAhead = LJS.tileCollisionGetData(ahead.subtract(vec2(0,1))) > 0;
                if (this.groundObject && (wallAhead || !groundAhead))
                    this.patrolDir *= -1;
                this.moveInput.x = this.patrolDir;
            }
        }
        super.update();
    }

    kill(damagingObject)
    {
        if (this.isDead())
            return;
        Game.addToScore(150);
        super.kill(damagingObject);
    }
}

///////////////////////////////////////////////////////////////////////////////

export class Turret extends GameObjects.GameObject
{
    constructor(pos)
    {
        super(pos, vec2(.9,.7), Game.spriteAtlas.turret);

        this.team = 'enemy';
        this.color = hsl(LJS.rand(.05,.12), .5, .7);
        this.health = 8;
        this.mass = 20;         // barely moved by bullets
        this.aimAngle = LJS.rand(LJS.PI*2);
        this.fireTimer = new Timer(LJS.rand(1,2));
        this.setCollision(true, false);
        GameObjects.hostiles.push(this);
    }

    update()
    {
        super.update();

        const player = Game.player;
        if (!player || player.isDead())
            return;

        const muzzle = this.pos.add(vec2(0,.2));
        const toPlayer = player.pos.subtract(muzzle);
        if (toPlayer.length() > 14 || !canSee(muzzle, player.pos))
            return;

        // swing the barrel toward the player, then fire when roughly on target
        const target = toPlayer.angle();
        let delta = LJS.mod(target - this.aimAngle + LJS.PI, 2*LJS.PI) - LJS.PI;
        this.aimAngle += LJS.clamp(delta, -.05, .05);
        if (this.fireTimer.elapsed() && LJS.abs(delta) < .2)
        {
            const rate = LJS.max(1.4 - Game.mission*.1, .7);
            this.fireTimer.set(rate);
            const direction = vec2().setAngle(this.aimAngle, 1);
            const bullet = new GameObjects.Bullet(muzzle.add(direction.scale(.6)), this, direction.scale(.18), 1);
            bullet.range = 14;
            bullet.color = hsl(.05,1,.6);
            GameEffects.playSound(GameEffects.sound_enemyShoot, this.pos);
        }
    }

    kill()
    {
        // its own explosion damages it again, so guard against dying twice
        if (this.destroyed || this.dying)
            return;
        this.dying = true;

        Game.addToScore(250);
        GameEffects.explosion(this.pos, 2, 'player'); // the blast never punishes the shooter
        this.destroy();
    }

    render()
    {
        // gun sprite points right (clockwise angle PI/2), mirrored it points left
        const barrelPos = this.pos.add(vec2(0,.2));
        const mirror = LJS.sin(this.aimAngle) < 0;
        const rotation = this.aimAngle + (mirror ? LJS.PI/2 : -LJS.PI/2);
        LJS.drawTile(barrelPos, vec2(.8), Game.spriteAtlas.gun, this.color, rotation, mirror, this.additiveColor);
        LJS.drawTile(this.pos.add(vec2(0,.15)), vec2(1), this.tileInfo, this.color, 0, false, this.additiveColor);
    }
}
