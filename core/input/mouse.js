/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2012 Joel Martin
 * Copyright (C) 2013 Samuel Mannehed for Cendio AB
 * Licensed under MPL 2.0 or any later version (see LICENSE.txt)
 */

/*jslint browser: true, white: false */
/*global window, Util */

import * as Log from '../util/logging.js';
import { isTouchDevice } from '../util/browsers.js';
import { setCapture, stopEvent, getPointerEvent } from '../util/events.js';
import { set_defaults, make_properties } from '../util/properties.js';

var WHEEL_STEP = 10; // Delta threshold for a mouse wheel step
var WHEEL_STEP_TIMEOUT = 50; // ms
var WHEEL_LINE_HEIGHT = 19;

export default function Mouse(defaults) {

    this._doubleClickTimer = null;
    this._lastTouchPos = null;

    this._wheelPos = null;
    this._wheelStepTimer = null;
    this._accumulatedWheelDeltaX = 0;
    this._accumulatedWheelDeltaY = 0;

    // Configuration attributes
    set_defaults(this, defaults, {
        'target': document,
        'focused': true,
        'touchButton': 1
    });

    this._eventHandlers = {
        'mousedown': this._handleMouseDown.bind(this),
        'mouseup': this._handleMouseUp.bind(this),
        'mousemove': this._handleMouseMove.bind(this),
        'mousewheel': this._handleMouseWheel.bind(this),
        'mousedisable': this._handleMouseDisable.bind(this)
    };
};

Mouse.prototype = {
    // private methods

    _resetDoubleClickTimer: function () {
        this._doubleClickTimer = null;
    },

    _handleMouseButton: function (e, down) {
        if (!this._focused) { return; }

        var pos = this._getMousePosition(e);

        var bmask;
        if (e.touches || e.changedTouches) {
            // Touch device

            // When two touches occur within 500 ms of each other and are
            // close enough together a double click is triggered.
            if (down == 1) {
                if (this._doubleClickTimer === null) {
                    this._lastTouchPos = pos;
                } else {
                    clearTimeout(this._doubleClickTimer);

                    // When the distance between the two touches is small enough
                    // force the position of the latter touch to the position of
                    // the first.

                    var xs = this._lastTouchPos.x - pos.x;
                    var ys = this._lastTouchPos.y - pos.y;
                    var d = Math.sqrt((xs * xs) + (ys * ys));

                    // The goal is to trigger on a certain physical width, the
                    // devicePixelRatio brings us a bit closer but is not optimal.
                    var threshold = 20 * (window.devicePixelRatio || 1);
                    if (d < threshold) {
                        pos = this._lastTouchPos;
                    }
                }
                this._doubleClickTimer = setTimeout(this._resetDoubleClickTimer.bind(this), 500);
            }
            bmask = this._touchButton;
            // If bmask is set
        } else if (e.which) {
            /* everything except IE */
            bmask = 1 << e.button;
        } else {
            /* IE including 9 */
            bmask = (e.button & 0x1) +      // Left
                    (e.button & 0x2) * 2 +  // Right
                    (e.button & 0x4) / 2;   // Middle
        }

        if (this._onMouseButton) {
            Log.Debug("onMouseButton " + (down ? "down" : "up") +
                       ", x: " + pos.x + ", y: " + pos.y + ", bmask: " + bmask);
            this._onMouseButton(pos.x, pos.y, down, bmask);
        }
        stopEvent(e);
    },

    _handleMouseDown: function (e) {
        // Touch events have implicit capture
        if (e.type === "mousedown") {
            setCapture(this._target);
        }

        this._handleMouseButton(e, 1);
    },

    _handleMouseUp: function (e) {
        this._handleMouseButton(e, 0);
    },

    // Mouse wheel events are sent in steps over VNC. This means that the VNC
    // protocol can't handle a wheel event with specific distance or speed.
    // Therefor, if we get a lot of small mouse wheel events we combine them.
    _generateWheelStepX: function () {

        if (this._accumulatedWheelDeltaX < 0) {
            this._onMouseButton(this._wheelPos.x, this._wheelPos.y, 1, 1 << 5);
            this._onMouseButton(this._wheelPos.x, this._wheelPos.y, 0, 1 << 5);
        } else if (this._accumulatedWheelDeltaX > 0) {
            this._onMouseButton(this._wheelPos.x, this._wheelPos.y, 1, 1 << 6);
            this._onMouseButton(this._wheelPos.x, this._wheelPos.y, 0, 1 << 6);
        }

        this._accumulatedWheelDeltaX = 0;
    },

    _generateWheelStepY: function () {

        if (this._accumulatedWheelDeltaY < 0) {
            this._onMouseButton(this._wheelPos.x, this._wheelPos.y, 1, 1 << 3);
            this._onMouseButton(this._wheelPos.x, this._wheelPos.y, 0, 1 << 3);
        } else if (this._accumulatedWheelDeltaY > 0) {
            this._onMouseButton(this._wheelPos.x, this._wheelPos.y, 1, 1 << 4);
            this._onMouseButton(this._wheelPos.x, this._wheelPos.y, 0, 1 << 4);
        }

        this._accumulatedWheelDeltaY = 0;
    },

    _resetWheelStepTimers: function () {
        window.clearTimeout(this._wheelStepXTimer);
        window.clearTimeout(this._wheelStepYTimer);
        this._wheelStepXTimer = null;
        this._wheelStepYTimer = null;
    },

    _handleMouseWheel: function (e) {
        if (!this._focused || !this._onMouseButton) { return; }

        this._resetWheelStepTimers();

        this._wheelPos = this._getMousePosition(e);

        var dX = e.deltaX;
        var dY = e.deltaY;

        // Pixel units unless it's non-zero.
        // Note that if deltamode is line or page won't matter since we aren't
        // sending the mouse wheel delta to the server anyway.
        // The difference between pixel and line can be important however since
        // we have a threshold that can be smaller than the line height.
        if (e.deltaMode !== 0) {
            dX *= WHEEL_LINE_HEIGHT;
            dY *= WHEEL_LINE_HEIGHT;
        }

        this._accumulatedWheelDeltaX += dX;
        this._accumulatedWheelDeltaY += dY;

        // Generate a mouse wheel step event when the accumulated delta
        // for one of the axes is large enough.
        // Small delta events that do not pass the threshold get sent
        // after a timeout.
        if (Math.abs(this._accumulatedWheelDeltaX) > WHEEL_STEP) {
            this._generateWheelStepX();
        } else {
            this._wheelStepXTimer =
                window.setTimeout(this._generateWheelStepX.bind(this),
                                  WHEEL_STEP_TIMEOUT);
        }
        if (Math.abs(this._accumulatedWheelDeltaY) > WHEEL_STEP) {
            this._generateWheelStepY();
        } else {
            this._wheelStepYTimer =
                window.setTimeout(this._generateWheelStepY.bind(this),
                                  WHEEL_STEP_TIMEOUT);
        }

        stopEvent(e);
    },

    _handleMouseMove: function (e) {
        if (! this._focused) { return; }

        var pos = this._getMousePosition(e);
        if (this._onMouseMove) {
            this._onMouseMove(pos.x, pos.y);
        }
        stopEvent(e);
    },

    _handleMouseDisable: function (e) {
        if (!this._focused) { return; }

        /*
         * Stop propagation if inside canvas area
         * Note: This is only needed for the 'click' event as it fails
         *       to fire properly for the target element so we have
         *       to listen on the document element instead.
         */
        if (e.target == this._target) {
            stopEvent(e);
        }
    },

    // Return coordinates relative to target
    _getMousePosition: function(e) {
        e = getPointerEvent(e);
        var bounds = this._target.getBoundingClientRect();
        var x, y;
        // Clip to target bounds
        if (e.clientX < bounds.left) {
            x = 0;
        } else if (e.clientX >= bounds.right) {
            x = bounds.width - 1;
        } else {
            x = e.clientX - bounds.left;
        }
        if (e.clientY < bounds.top) {
            y = 0;
        } else if (e.clientY >= bounds.bottom) {
            y = bounds.height - 1;
        } else {
            y = e.clientY - bounds.top;
        }
        return {x:x, y:y};
    },

    // Public methods
    grab: function () {
        var c = this._target;

        if (isTouchDevice) {
            c.addEventListener('touchstart', this._eventHandlers.mousedown);
            c.addEventListener('touchend', this._eventHandlers.mouseup);
            c.addEventListener('touchmove', this._eventHandlers.mousemove);
        }
        c.addEventListener('mousedown', this._eventHandlers.mousedown);
        c.addEventListener('mouseup', this._eventHandlers.mouseup);
        c.addEventListener('mousemove', this._eventHandlers.mousemove);
        c.addEventListener('wheel', this._eventHandlers.mousewheel);

        /* Prevent middle-click pasting (see above for why we bind to document) */
        document.addEventListener('click', this._eventHandlers.mousedisable);

        /* preventDefault() on mousedown doesn't stop this event for some
           reason so we have to explicitly block it */
        c.addEventListener('contextmenu', this._eventHandlers.mousedisable);
    },

    ungrab: function () {
        var c = this._target;

        this._resetWheelStepTimers();

        if (isTouchDevice) {
            c.removeEventListener('touchstart', this._eventHandlers.mousedown);
            c.removeEventListener('touchend', this._eventHandlers.mouseup);
            c.removeEventListener('touchmove', this._eventHandlers.mousemove);
        }
        c.removeEventListener('mousedown', this._eventHandlers.mousedown);
        c.removeEventListener('mouseup', this._eventHandlers.mouseup);
        c.removeEventListener('mousemove', this._eventHandlers.mousemove);
        c.removeEventListener('wheel', this._eventHandlers.mousewheel);

        document.removeEventListener('click', this._eventHandlers.mousedisable);

        c.removeEventListener('contextmenu', this._eventHandlers.mousedisable);
    }
};

make_properties(Mouse, [
    ['target',         'ro', 'dom'],   // DOM element that captures mouse input
    ['focused',        'rw', 'bool'],  // Capture and send mouse clicks/movement

    ['onMouseButton',  'rw', 'func'],  // Handler for mouse button click/release
    ['onMouseMove',    'rw', 'func'],  // Handler for mouse movement
    ['touchButton',    'rw', 'int']    // Button mask (1, 2, 4) for touch devices (0 means ignore clicks)
]);
