/* file : utils-test.js
MIT License

Copyright (c) 2017 Thomas Minier & Arnaud Grall

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

import { expect, describe, test } from '@jest/globals'
import {
    allocateArray,
    randomInt,
    xorBuffer,
    getDefaultSeed,
    isEmptyBuffer,
} from '../src/utils'
import { BloomFilter, BaseFilter } from '../src/api'
import XXH from '@node-rs/xxhash'
import { range } from 'lodash'
const seed = getDefaultSeed()
import { Hashing } from '../src/api'

describe('Utils', () => {
    describe('#allocateArray', () => {
        test('should allocate an array with the given size and a default value', () => {
            const array = allocateArray(15, 1)
            expect(array.length).toEqual(15)
            array.forEach(value => {
                expect(value).toEqual(1)
            })
        })

        test('should allow the use of a function to set the default value', () => {
            const array = allocateArray(15, () => 'foo')
            expect(array.length).toEqual(15)
            array.forEach(value => {
                expect(value).toEqual('foo')
            })
        })
    })

    describe('#doubleHashing', () => {
        test('should perform a double hashing', () => {
            const hashing = new Hashing()
            function getRandomInt(min: number, max: number) {
                // The maximum is exclusive and the minimum is inclusive
                const minCeiled = Math.ceil(min)
                const maxFloored = Math.floor(max)
                return Math.floor(
                    Math.random() * (maxFloored - minCeiled) + minCeiled
                )
            }
            const hashA = getRandomInt(Number.MIN_VALUE, Number.MAX_VALUE / 2)
            const hashB = getRandomInt(Number.MAX_VALUE / 2, Number.MAX_VALUE)
            const size = 1000
            const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
            values.forEach(n => {
                expect(hashing.doubleHashing(n, hashA, hashB, size)).toEqual(
                    (hashA + n * hashB + (n ** 3 - n) / 6) % size
                )
            })
        })
    })

    describe('#randomInt', () => {
        test('should generate a random int in an interval', () => {
            const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
            expect(values).toContain(randomInt(values[0], values[9]))
        })
    })

    describe('#xorBuffer', () => {
        test('should xor correctly 2 Buffers', () => {
            const a = Buffer.allocUnsafe(10).fill(0)
            const b = Buffer.alloc(1, 1)
            const res = Buffer.allocUnsafe(10).fill(0)
            res[res.length - 1] = 1
            // xor(a, b) = <Buffer 00 00 00 00 00 00 00 00 00 01>
            expect(
                xorBuffer(Buffer.from(a), Buffer.from(b)).toString()
            ).toEqual(b.toString())
            // xor(xor(a, b), b) === a <Buffer 00 00 00 00 00 00 00 00 00 00> === <Buffer />
            expect(
                xorBuffer(
                    xorBuffer(Buffer.from(a), Buffer.from(b)),
                    Buffer.from(b)
                ).toString()
            ).toEqual(Buffer.from('').toString())
            // xor(xor(a, b), a) === b
            expect(
                xorBuffer(
                    xorBuffer(Buffer.from(a), Buffer.from(b)),
                    Buffer.from(a)
                ).toString()
            ).toEqual(Buffer.from(b).toString())
            // xor(xor(a, a), a) === a
            expect(
                xorBuffer(
                    xorBuffer(Buffer.from(a), Buffer.from(a)),
                    Buffer.from(a)
                ).toString()
            ).toEqual(Buffer.from('').toString())
            // xor(xor(b, b), b) === a
            expect(
                xorBuffer(
                    xorBuffer(Buffer.from(b), Buffer.from(b)),
                    Buffer.from(b)
                ).toString()
            ).toEqual(Buffer.from(b).toString())
        })
        test('should xor correctly', () => {
            let a = Buffer.allocUnsafe(1).fill(1)
            let b = Buffer.allocUnsafe(1).fill(1)
            const max = 100
            let last
            for (let i = 0; i < max; i++) {
                const s = XXH.xxh32(i.toString(), seed).toString(16)
                const buf = Buffer.from(s)
                a = xorBuffer(a, buf)
                if (i !== max - 1) {
                    b = xorBuffer(buf, b)
                } else {
                    last = buf
                }
            }
            expect(xorBuffer(a, b).equals(last)).toBe(true)
            expect(xorBuffer(a, b).toString()).toEqual(last.toString())
            expect(xorBuffer(a, a).equals(Buffer.allocUnsafe(0))).toBe(true)
            expect(xorBuffer(b, b).equals(Buffer.allocUnsafe(0))).toBe(true)
        })
    })

    describe('#isBufferEmpty', () => {
        test('should return true if a buffer is empty', () => {
            expect(isEmptyBuffer(Buffer.allocUnsafe(10).fill(0))).toBe(true)
            expect(isEmptyBuffer(Buffer.allocUnsafe(0).fill(0))).toBe(true)
        })
        test('should return false if a buffer is not empty', () => {
            expect(isEmptyBuffer(Buffer.allocUnsafe(10).fill(1))).toBe(false)
        })
    })

    describe('#getDistinctIndexes', () => {
        const key =
            'da5e21f8a67c4163f1a53ef43515bd027967da305ecfc741b2c3f40f832b7f82'
        const desiredIndices = 10000
        const result = range(0, desiredIndices, 1)
        test(`should return ${desiredIndices.toString()} distinct indices on the interval [0, ${desiredIndices.toString()})`, () => {
            try {
                const obj = new (class extends BaseFilter {})()
                const start = new Date().getTime()
                const indices = obj._hashing
                    .getDistinctIndexes(key, desiredIndices, desiredIndices)
                    .sort((a, b) => a - b)
                expect(indices).toEqual(result)
                console.log(
                    `Generated ${indices.length.toString()} distinct indices on the interval [0, ${desiredIndices.toString()}) in ${(
                        new Date().getTime() - start
                    ).toString()} ms`
                )
            } catch (e) {
                throw Error(e)
            }
        })
        test('should the issue be fixed', () => {
            try {
                const filter = new BloomFilter(39, 28)
                filter.add(key)
                expect(filter.has(key)).toBe(true)
            } catch (e) {
                throw Error(e)
            }
        })
    })

    describe('Use different hash functions', () => {
        test('overriding serialize function by always returning Number(1)', () => {
            class CustomHashing extends Hashing {
                serialize() {
                    return Number(1)
                }
            }
            const bl = BloomFilter.create(2, 0.01)
            bl._hashing = new CustomHashing()
            bl.add('a')
            const bl2 = BloomFilter.create(2, 0.01)
            bl2._hashing = new CustomHashing()
            bl2.add('b')
            // 2 bloom filters with a hash functions returning everytime the same thing must be equal
            expect(bl.equals(bl2)).toBe(true)
        })
    })
})
