/*global recast, esprima, escodegen, injector */

function Stepper (context) {
    this.context = context;
    this.context.instantiate = function (Class) {
        var obj = Object.create(Class.prototype);
        var args = Array.prototype.slice.call(arguments, 1);
        var gen = Class.apply(obj, args);
        gen.obj = obj;
        return gen;
    };

    this.yieldVal = undefined;
    this.breakpoints = {};
}

Stepper.isBrowserSupported = function () {
    try {
        return Function("\nvar generator = (function* () {\n  yield* (function* () {\n    yield 5; yield 6;\n  }());\n}());\n\nvar item = generator.next();\nvar passed = item.value === 5 && item.done === false;\nitem = generator.next();\npassed    &= item.value === 6 && item.done === false;\nitem = generator.next();\npassed    &= item.value === undefined && item.done === true;\nreturn passed;\n  ")()
    } catch(e) {
        return false;
    }
};

Stepper.prototype.generateDebugCode = function (code) {
    this.ast = esprima.parse(code, { loc: true });

    injector.process(this.ast, this.context);

    return "return function*(){\nwith(arguments[0]){\n"
        + escodegen.generate(this.ast) + "\n}\n}";
};

Stepper.prototype.load = function (code) {
    this.debugCode = this.generateDebugCode(code);
    this.reset();
};

Stepper.prototype.reset = function () {
    this.stack = new Stack();
    
    var self = this;
    this.stack.poppedLastItem = function () {
        self.done = true;
    };
    this.done = false;
    
    this.stack.push({
        gen: ((new Function(this.debugCode))())(this.context),
        lineno: 0
    });
};

Stepper.prototype.halted = function () {
    return this.done;
};

Stepper.prototype._step = function () {
    if (this.stack.isEmpty()) {
        this.done = true;
        return;
    }
    var frame = this.stack.peek();
    var result = frame.gen.next(this.yieldVal);
    this.yieldVal = undefined;
    return result;
};

Stepper.prototype._runScope = function (frame) {
    this.stack.push(frame);

    var result = this._step();
    while (!result.done) {
        if (result.value.gen) {
            this._runScope(result.value);
        }
        result = this._step();
    }
    
    this._popAndStoreYieldValue(result.value);
};

Stepper.prototype._popAndStoreYieldValue = function (value) {
    var frame = this.stack.pop();
    this.yieldVal = frame.gen.obj || value;
    return frame;
};

Stepper.prototype.stepIn = function () {
    var result;
    if (result = this._step()) {
        if (result.done) {
            var frame = this._popAndStoreYieldValue(result.value);
            return frame.lineno;
        } else if (result.value.gen) {
            this.stack.push(result.value);
            return this.stepIn();
        }
        return result.value.lineno;
    }
};

Stepper.prototype.stepOver = function () {
    var result;
    if (result = this._step()) {
        if (result.done) {
            var frame = this._popAndStoreYieldValue(result.value);
            return frame.lineno;
        } else if (result.value.gen) {
            this._runScope(result.value);
            return this.stepOver();
        }
        return result.value.lineno;
    }
};

Stepper.prototype.stepOut = function () {
    var result;
    if (result = this._step()) {
        while (!result.done) {
            if (result.value.gen) {
                this._runScope(result.value);
            }
            result = this._step();
        }
        var frame = this._popAndStoreYieldValue(result.value);
        return frame.lineno;
    }
};

Stepper.prototype.run = function () {
    while (!this.stack.isEmpty()) {
        var lineno = this.stepIn();
        if (this.breakpoints[lineno]) {
            return lineno;
        }
    }
    this.done = true;
    return lineno;
};

Stepper.prototype.setBreakpoint = function (lineno) {
    this.breakpoints[lineno] = true;
};

Stepper.prototype.clearBreakpoint = function (lineno) {
    delete this.breakpoints[lineno];
};
