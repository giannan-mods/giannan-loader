let refIdCounter = 0;

function findRefs(obj, refs = new Map(), path = []) {
    if (obj && typeof obj === 'object') {
        if (refs.has(obj)) {
            return refs.get(obj);
        }

        refs.set(obj, generateRefId());
        path = path.concat([]);

        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                findRefs(obj[i], refs, path.concat(i));
            }
        } else {
            for (let key in obj) {
                findRefs(obj[key], refs, path.concat(key));
            }
        }
    }

    return refs;
}

function generateRefId() {
    return (++refIdCounter).toString(36);
}

function isObject(o) {
    return o && 'object' == typeof o;
}

function sameRef(a, b, aRefs, bRefs) {
    if (!a || !b) return false;
    return aRefs.get(a) === bRefs.get(b);
}

function cpy(o) {
    if (!o) return o;
    return JSON.parse(JSON.stringify(o));
}

function _equal(a, b) {
    if (Object.is(a, b)) {
        return true;
    }

    if ((a && !b) || (!a && b)) {
        return false;
    }

    if (Array.isArray(a)) {
        if (a.length !== b.length) {
            return false;
        }

        for (let i in a) {
            if (!_equal(a[i], b[i])) {
                return false;
            }
        }

        return true;
    }

    if (typeof a === 'object' && typeof b === 'object') {
        const aKeys = Object.keys(a);
        const bKeys = Object.keys(b);

        if (aKeys.length !== bKeys.length) {
            return false;
        }

        for (let i in aKeys) {
            const key = aKeys[i];

            if (!_equal(a[key], b[key])) {
                return false;
            }
        }

        return true;
    }

    return a === b;
}

var exports = module.exports = function (deps, exports) {
    let equal = (deps && deps.equal) || _equal;
    const adiff = require('./adiff')({equal: equal});
    exports = exports || {}

    function _diff(a, b, path, aRefs, bRefs, visited) {
        path = path || [];
        visited = visited || new Set();

        if (visited.has(a) || visited.has(b)) {
            return [];
        }

        visited.add(a);
        visited.add(b);

        let delta = [];

        if (Array.isArray(a) && Array.isArray(b)) {
            const d = adiff.diff(a, b);
            if (d.length) delta.push(["splice", path, d]);
            return delta;
        }

        for (let k in b) {
            if (isObject(a[k]) && isObject(b[k]) && sameRef(b[k], a[k], aRefs, bRefs)) {
                delta = delta.concat(_diff(a[k], b[k], path.concat(k), aRefs, bRefs, visited));
            } else if (b[k] !== a[k]) {
                delta.push(["set", path.concat(k), cpy(b[k])]);
            }
        }

        for (let k in a) {
            if ("undefined" == typeof b[k]) {
                delta.push(["del", path.concat(k)]);
            }
        }

        return delta;
    }

    exports.diff = function (a, b) {
        const aRefs = findRefs(a);
        const bRefs = findRefs(b);
        const visited = new Set();
        const delta = _diff(a, b, [], aRefs, bRefs, visited);

        if (delta.length) return delta;
    };

    exports.patch = function (a, patch) {
        if (!patch) throw new Error('expected patch');

        function applyChange(obj, change) {
            let [operation, path, value] = change;
            let target = obj;

            for (let i = 0; i < path.length - 1; i++) {
                target = target[path[i]];
            }

            if (operation === "set") {
                target[path[path.length - 1]] = cpy(value);
            } else if (operation === "del") {
                delete target[path[path.length - 1]];
            } else if (operation === "splice") {
                adiff.patch(target, value, true);
            } else {
                throw new Error("Unknown operation: " + operation);
            }
        }

        let newObject = JSON.parse(JSON.stringify(a));
        patch.forEach((change) => applyChange(newObject, change));
        return newObject;
    };

    exports.diff3 = function (a, o, b) {
        if (arguments.length === 1) {
            o = a[1], b = a[2], a = a[0];
        }

        const _a = exports.diff(o, a) || [];
        const _b = exports.diff(o, b) || [];

        const conflicts = [];

        function srt(a, asc = true) {
            for (let i = 0; i < a.length; i++) {
                if (a[i][0] === "splice") {
                    a[i][2].sort((a, b) => asc ? a[0] - b[0] : b[0] - a[0]);
                }
            }
        }

        function cmp(a, b) {
            if (!b) return 1;
            const p = a[1], q = b[1];

            let i = 0;
            while (p[i] === q[i] && p[i] != null) i++;

            if (p[i] === q[i]) return 0;
            return p[i] < q[i] ? -1 : 1;
        }

        function isPrefix(a, b) {
            if (!b) return 1;
            const p = a[1], q = b[1];

            let i = 0;
            while (p[i] === q[i] && i < p.length && i < q.length) i++;

            if (i === p.length || i === q.length) return 0;
            return p[i] < q[i] ? -1 : 1;
        }

        function cmpSp(a, b) {
            if (a == null) return -1;
            else if (b == null) return 1;
            if (a[0] === b[0]) return 0;

            function max(k) {
                return k[0] + (k[1] >= 1 ? k[1] - 1 : 0);
            }

            if (max(a) < b[0] || max(b) < a[0]) return a[0] - b[0];
            return 0;
        }

        function resolveAry(a, b) {
            if (a == null) return b;
            if (b == null) return a;

            conflicts.push({
                "source": a,
                "target": b,
                "fatal": false,
            });

            if (a[0] === b[0]) {
                const lss = adiff.lss(b.slice(2), a.slice(2));

                if (a[1] === b[1]) {
                    // Both start at the same index, and delete the same number.
                    return [a[0], a[1]].concat(lss, b.slice(2 + lss.length), a.slice(2 + lss.length));
                } else if (a[1] === 0 && b[1] !== 0) {
                    // Both start at the same index, and only one deletes something.
                    return [a[0], b[1]].concat(lss, b.slice(2 + lss.length), a.slice(2 + lss.length));
                } else if (a[1] !== 0 && b[1] === 0) {
                    // Both start at the same index, and only one deletes something.
                    return [a[0], a[1]].concat(lss, b.slice(2 + lss.length), a.slice(2 + lss.length));
                }
            }

            conflicts[conflicts.length - 1]["fatal"] = true;

            return a;
        }

        function resolve(a, b) {
            if (a == null) return b;
            if (b == null) return a;

            if (a[1].length === b[1].length) {
                if (a[0] === b[0]) {
                    if (a[0] === 'splice') {
                        const r = merge(a[2], b[2], cmpSp, resolveAry);
                        return ['splice', a[1].slice(), r];
                    } else if (equal(a[2], b[2])) {
                        return a;
                    }
                }
            }

            return a
        }

        function merge(a, b, cmp, resolve) {
            let i = a.length > 0 ? a.length - 1 : -1;
            let j = b.length > 0 ? b.length - 1 : -1;
            let res = [];

            while (~i && ~j) {
                const c = cmp(a[i], b[j]);
                if (c > 0) res.push(a[i--]);
                if (c < 0) res.push(b[j--]);
                if (!c) {
                    const r = resolve(a[i], b[j]);
                    if (equal(r, a[i])) j--;
                    else if (equal(r, b[j])) i--;
                    else {
                        res.push(r);
                        i--, j--;
                    }
                }
            }
            while (~i) res.push(a[i--]);
            while (~j) res.push(b[j--]);
            return res
        }

        _a.sort(cmp);
        _b.sort(cmp);

        srt(_a, true);
        srt(_b, true);

        const m = merge(_a, _b, isPrefix, resolve);

        srt(m, false);

        return {
            "diff": m.length ? m : null,
            "conflicts": conflicts,
        }
    }

    return exports;
};

exports(null, exports);