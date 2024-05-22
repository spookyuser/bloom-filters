import WritableFilter from './interfaces/writable-filter.js'
import BaseFilter from './base-filter.js'
import Bucket, { ExportedBucket } from './bucket.js'
import {
    ExportedBigInt,
    allocateArray,
    exportBigInt,
    getNearestPow2,
    importBigInt,
    randomInt,
} from './utils.js'
import { HashableInput } from './types.js'

/**
 * Compute the optimal fingerprint length in bits for a given bucket size
 * and a false positive rate.
 * @param  {int} size - The filter bucket size
 * @param  {int} rate - The error rate, i.e. 'false positive' rate, targetted by the filter
 * @return {int} The optimal fingerprint length in bits
 * @private
 */
function computeFingerpintLength(size: number, rate: number): number {
    return Math.ceil(Math.log2(1 / rate) + Math.log2(2 * size))
}

export interface ExportedCuckooFilter {
    _size: number
    _fingerprintLength: number
    _length: number
    _maxKicks: number
    _filter: ExportedBucket<string>[]
    _seed: ExportedBigInt
    _bucketSize: number
}

/**
 * Cuckoo filters improve on Bloom filters by supporting deletion, limited counting,
 * and bounded False positive rate with similar storage efficiency as a standard Bloom filter.
 *
 * Reference: Fan, B., Andersen, D. G., Kaminsky, M., & Mitzenmacher, M. D. (2014, December). Cuckoo filter: Practically better than bloom.
 * In Proceedings of the 10th ACM International on Conference on emerging Networking Experiments and Technologies (pp. 75-88). ACM.
 * @see {@link https://www.cs.cmu.edu/~dga/papers/cuckoo-conext2014.pdf} for more details about Cuckoo filters
 * @author Thomas Minier & Arnaud Grall
 */
export default class CuckooFilter extends BaseFilter implements WritableFilter<HashableInput> {
    public _filter: Bucket<string>[]
    public _size: number
    public _bucketSize: number
    public _fingerprintLength: number
    public _length: number
    public _maxKicks: number
    /**
     * Constructor
     * @param size - The filter size
     * @param fingerprintSize - The length of the fingerprints in bits
     * @param bucketSize - The size of the buckets in the filter
     * @param maxKicks - (optional) The max number of kicks when resolving collision at insertion, default to 500
     */
    constructor(size: number, fingerprintSize: number, bucketSize: number, maxKicks = 500) {
        super()
        const s = Number(BigInt.asUintN(32, getNearestPow2(BigInt(size))))
        this._filter = allocateArray(s, () => new Bucket(bucketSize))
        this._size = s
        this._bucketSize = bucketSize
        this._fingerprintLength = fingerprintSize
        this._length = 0
        this._maxKicks = maxKicks
    }

    public hash(element: HashableInput) {
        return this._hashing._lib.xxh64(element, this.seed)
    }

    /**
     * Return a new optimal CuckooFilter given the number of maximum elements to store and the error rate desired
     * @param size - The number of items to store
     * @param errorRate - (optional, default=0.01) The error rate of the filter
     * @param bucketSize - (optional, default=4) The number of buckets desired per cell
     * @param maxKicks - (optional, default=500) The number of kicks done when a collision occurs
     * @return A Cuckoo Filter optimal for these parameters
     */
    public static create(
        size: number,
        errorRate: number,
        bucketSize = 4,
        maxKicks = 500,
    ): CuckooFilter {
        const fl = computeFingerpintLength(bucketSize, errorRate)
        const capacity = Math.ceil(Math.max(size, 32) / bucketSize / 0.955)
        return new CuckooFilter(capacity, fl, bucketSize, maxKicks)
    }

    /**
     * Build a new optimal CuckooFilter from an iterable with a fixed error rate
     * @param items - Iterable used to populate the filter
     * @param errorRate - (optional, default=0.01) The error rate of the filter
     * @param bucketSize - (optional, default=4) The number of buckets desired per cell
     * @param maxKicks - (optional, default=500) The number of kicks done when a collision occurs
     * @param seed - (optional) the seed to use
     * @return A new Cuckoo Filter filled with the iterable's elements
     */
    public static from(
        items: Iterable<HashableInput>,
        errorRate: number = 0.01,
        bucketSize = 4,
        maxKicks = 500,
        seed?: bigint,
    ): CuckooFilter {
        const array = Array.from(items)
        const filter = CuckooFilter.create(array.length, errorRate, bucketSize, maxKicks)
        if (seed) filter.seed = seed
        array.forEach(item => filter.add(item))
        return filter
    }

    /**
     * Get the filter size
     */
    public get size(): number {
        return this._size
    }

    /**
     * Get the filter full size, i.e., the total number of cells
     */
    public get fullSize(): number {
        return this.size * this.bucketSize
    }

    /**
     * Get the filter length, i.e. the current number of elements in the filter
     */
    public get length(): number {
        return this._length
    }

    /**
     * Get the length of the fingerprints in the filter
     */
    public get fingerprintLength(): number {
        return this._fingerprintLength
    }

    /**
     * Get the size of the buckets in the filter
     */
    public get bucketSize(): number {
        return this._bucketSize
    }

    /**
     * Get the max number of kicks when resolving collision at insertion
     */
    public get maxKicks(): number {
        return this._maxKicks
    }

    /**
     * Add an element to the filter, if false is returned, it means that the filter is considered as full.
     * @param element - The element to add
     * @return True if the insertion is a success, False if the filter is full
     * @example
     * ```js
     * const filter = new CuckooFilter(15, 3, 2);
     * filter.add('alice');
     * filter.add('bob');
     * ```
     */
    public add(element: HashableInput, throwError = false, destructive = false): boolean {
        const locations = this._locations(element)
        // store fingerprint in an available empty bucket
        if (this._filter[locations.firstIndex].isFree()) {
            this._filter[locations.firstIndex].add(locations.fingerprint)
        } else if (this._filter[locations.secondIndex].isFree()) {
            this._filter[locations.secondIndex].add(locations.fingerprint)
        } else {
            let fingerprint = locations.fingerprint
            // buckets are full, we must relocate one of them
            let index = this.random() < 0.5 ? locations.firstIndex : locations.secondIndex
            const logs: [number, number, string | null][] = []
            for (let nbTry = 0; nbTry < this._maxKicks; nbTry++) {
                const rndIndex = randomInt(0, this._filter[index].length - 1, this.random)
                const tmp = this._filter[index].at(rndIndex)! // eslint-disable-line @typescript-eslint/no-non-null-assertion
                logs.push([index, rndIndex, tmp])
                // swap f with e's fingerprint
                this._filter[index].set(rndIndex, fingerprint)
                fingerprint = tmp
                // i = i ^ hash(fingerprint)
                index = Number(BigInt.asUintN(32, BigInt(index) ^ this.hash(tmp))) % this._size
                // add the moved element to the bucket if possible
                if (this._filter[index].isFree()) {
                    this._filter[index].add(fingerprint)
                    this._length++
                    return true
                }
            }
            if (!destructive) {
                // rollback all modified entries to their initial states
                let log
                while ((log = logs.pop())) {
                    this._filter[log[0]].set(log[1], log[2])
                }
            }
            // considered full
            if (throwError) {
                throw new Error(
                    `The Cuckoo Filter is full, cannot insert element "${element}"`, // eslint-disable-line @typescript-eslint/restrict-template-expressions
                )
            } else {
                return false
            }
        }
        this._length++
        return true
    }

    /**
     * Remove an element from the filter
     * @param element - The element to remove
     * @return True if the element has been removed from the filter, False if it wasn't in the filter
     * @example
     * ```js
     * const filter = new CuckooFilter(15, 3, 2);
     * filter.add('alice');
     * filter.add('bob');
     *
     * // remove an element
     * filter.remove('bob');
     * ```
     */
    public remove(element: HashableInput): boolean {
        const locations = this._locations(element)
        if (this._filter[locations.firstIndex].has(locations.fingerprint)) {
            this._filter[locations.firstIndex].remove(locations.fingerprint)
            this._length--
            return true
        } else if (this._filter[locations.secondIndex].has(locations.fingerprint)) {
            this._filter[locations.secondIndex].remove(locations.fingerprint)
            this._length--
            return true
        }
        return false
    }

    /**
     * Test an element for membership
     * @param element - The element to look for in the filter
     * @return False if the element is definitively not in the filter, True is the element might be in the filter
     * @example
     * ```js
     * const filter = new CuckooFilter(15, 3, 2);
     * filter.add('alice');
     *
     * console.log(filter.has('alice')); // output: true
     * console.log(filter.has('bob')); // output: false
     * ```
     */
    public has(element: HashableInput): boolean {
        const locations = this._locations(element)
        return (
            this._filter[locations.firstIndex].has(locations.fingerprint) ||
            this._filter[locations.secondIndex].has(locations.fingerprint)
        )
    }

    /**
     * Return the false positive rate for this cuckoo filter
     * @return The false positive rate
     */
    public rate(): number {
        const load = this._computeHashTableLoad()
        const c = this._fingerprintLength / load.load
        return Math.pow(2, Math.log2(2 * this._bucketSize) - load.load * c)
    }

    /**
     * Return the load of this filter
     * @return {Object} load: is the load, size is the number of entries, free is the free number of entries, used is the number of entry used
     */
    public _computeHashTableLoad() {
        const max = this._filter.length * this._bucketSize
        const used = this._filter.reduce((acc, val) => acc + val.length, 0)
        return {
            used,
            free: max - used,
            size: max,
            load: used / max,
        }
    }

    /**
     * For a element, compute its fingerprint and the index of its two buckets
     * @param element - The element to hash
     * @return The fingerprint of the element and the index of its two buckets
     * @private
     */
    public _locations(element: HashableInput) {
        const hash = this.hash(element)
        const hashstr = hash.toString(2).padStart(64, '0')
        if (this._fingerprintLength > hashstr.length) {
            throw new Error(
                `The fingerprint length (${this._fingerprintLength.toString()}) is higher than the hash length (${hashstr.length.toString()}). Please reduce the fingerprint length or report if it is an unexpected behavior.`,
            )
        }
        // take the first n bits
        const fingerprint = hashstr.substring(hashstr.length - this._fingerprintLength)
        const firstIndex = hash
        const secondIndex = firstIndex ^ this.hash(fingerprint)
        const res = {
            fingerprint,
            firstIndex: Number(BigInt.asUintN(32, firstIndex)) % this._size,
            secondIndex: Number(BigInt.asUintN(32, secondIndex)) % this._size,
        }
        return res
    }

    /**
     * Check if another Cuckoo filter is equal to this one
     * @param  filter - The cuckoo filter to compare to this one
     * @return True if they are equal, false otherwise
     */
    public equals(filter: CuckooFilter): boolean {
        let i = 0
        let res = true
        while (res && i < this._filter.length) {
            const bucket = this._filter[i]
            if (!filter._filter[i].equals(bucket)) {
                res = false
            }
            i++
        }
        return res
    }

    /**
     * Save this filter in JSON format
     * @returns
     */
    public saveAsJSON(): ExportedCuckooFilter {
        return {
            _size: this._size,
            _fingerprintLength: this._fingerprintLength,
            _length: this._length,
            _maxKicks: this._maxKicks,
            _filter: this._filter.map(f => f.saveAsJSON()),
            _seed: exportBigInt(this._seed),
            _bucketSize: this._bucketSize,
        }
    }

    /**
     * Import a JSON exported filter into a new CuckooFilter instance
     * @param element - The JSON exported object to import
     * @returns
     */
    public static fromJSON(element: ExportedCuckooFilter): CuckooFilter {
        const filter = new CuckooFilter(
            element._size,
            element._fingerprintLength,
            element._bucketSize,
            element._maxKicks as number | undefined,
        )
        filter.seed = importBigInt(element._seed)
        filter._length = element._length
        filter._filter = element._filter.map(e => Bucket.fromJSON<string>(e))
        return filter
    }
}
