import ClassicFilter from '../interfaces/classic-filter.mjs'
import BaseFilter, { prng } from '../base-filter.mjs'
import { HashableInput, SeedType } from '../types.mjs'
import PartitionBloomFilter, {
    ExportedPartitionedBloomFilter,
} from './partitioned-bloom-filter.mjs'
import seedrandom from 'seedrandom'

export interface ExportedScalableBloomFilter {
    _seed: SeedType
    _initial_size: number
    _error_rate: number
    _ratio: number
    _filters: ExportedPartitionedBloomFilter[]
}

/**
 * A Scalable Bloom Filter is a variant of Bloom Filters that can adapt dynamically to the
number of elements stored, while assuring a maximum false positive probability
 *
 * Reference: ALMEIDA, Paulo Sérgio, BAQUERO, Carlos, PREGUIÇA, Nuno, et al. Scalable bloom filters. Information Processing Letters, 2007, vol. 101, no 6, p. 255-261.
 * @see {@link https://citeseerx.ist.psu.edu/viewdoc/download?doi=10.1.1.725.390&rep=rep1&type=pdf}
 * @author Thomas Minier & Arnaud Grall
 */
export default class ScalableBloomFilter
    extends BaseFilter
    implements ClassicFilter<HashableInput>
{
    /**
     * Static value, will power the size of the new set, by default we will follow a power of 2.
     */
    public static _s = 2

    /**
     * The initial size of this filter in number of elements, not in bytes.
     */
    public _initial_size: number

    /**
     * The error rate desired.
     */
    public _error_rate: number

    /**
     * The load factor of each filter, By default: 0.5 half of the set
     */
    public _ratio: number

    /**
     * Internal Partition Bloom Filters
     */
    public _filters: PartitionBloomFilter[] = []

    constructor(_initial_size = 8, _error_rate = 0.01, _ratio = 0.5) {
        super()
        this._initial_size = _initial_size
        this._error_rate = _error_rate
        this._ratio = _ratio
        this._filters.push(
            PartitionBloomFilter.create(
                this._initial_size,
                this._error_rate,
                this._ratio
            )
        )
        this._filters[this._filters.length - 1].seed = this.seed
    }

    /**
     * @override
     * Return the current seed.
     * For obscure reason we must code this function...
     */
    public get seed() {
        return this._seed
    }

    /**
     * @override
     * Set the seed for this structure. If you override the seed after adding data,
     * all the filters will be updated and you may get wrong indexes for already indexed data
     * due to the seed change. So only change it once before adding data.
     * @param  seed the new seed that will be used in this structure
     */
    public set seed(seed: SeedType) {
        this._seed = seed
        this._rng = seedrandom(this._seed.toString()) as prng
        this._filters.forEach((filter: PartitionBloomFilter) => {
            filter.seed = this.seed
        })
    }

    /**
     * Add a new element to the filter
     * @param element
     */
    public add(element: HashableInput) {
        // determine if we need to create a new filter
        const currentFilter = this._filters[this._filters.length - 1]
        if (currentFilter._currentload() > currentFilter._loadFactor) {
            // create a new filter
            const newSize =
                this._initial_size *
                Math.pow(ScalableBloomFilter._s, this._filters.length + 1) *
                Math.LN2
            const newErrorRate =
                this._error_rate * Math.pow(this._ratio, this._filters.length)
            this._filters.push(
                PartitionBloomFilter.create(newSize, newErrorRate, this._ratio)
            )
            this._filters[this._filters.length - 1].seed = this.seed
        }
        // get the newly created filter
        this._filters[this._filters.length - 1].add(element)
    }

    /**
     * Return True if the element has been found, false otherwise.
     * Check until we found the value in a filter otherwise stop on the first value found.
     * @param element
     * @returns
     */
    public has(element: HashableInput) {
        return this._filters.some(filter => filter.has(element))
    }

    /**
     * Return the current capacity (number of elements) of this filter
     * @returns
     */
    public capacity(): number {
        return this._filters.map(f => f._capacity).reduce((p, c) => p + c, 0)
    }

    /**
     * Return the current false positive rate of this structure
     * @returns
     */
    public rate(): number {
        return this._filters[this._filters.length - 1].rate()
    }

    /**
     * Check if two ScalableBloomFilter are equal
     * @param filter
     * @returns
     */
    public equals(filter: ScalableBloomFilter) {
        // assert the seed, the ratio and the capacity are equals
        if (
            this.seed !== filter.seed ||
            this._ratio !== filter._ratio ||
            this.capacity() !== filter.capacity()
        ) {
            return false
        }
        return this._filters.every(
            (currentFilter: PartitionBloomFilter, index) =>
                filter._filters[index].equals(currentFilter)
        )
    }

    /**
     * Create a Scalable Bloom Filter based on Partitionned Bloom Filter.
     * @param _size the starting size of the filter
     * @param _error_rate ther error rate desired of the filter
     * @param _ratio the load factor desired
     * @returns
     */
    public static create(_size: number, _error_rate: number, _ratio = 0.5) {
        return new ScalableBloomFilter(_size, _error_rate, _ratio)
    }

    public saveAsJSON(): ExportedScalableBloomFilter {
        return {
            _initial_size: this._initial_size,
            _error_rate: this._error_rate,
            _filters: this._filters.map(filter => filter.saveAsJSON()),
            _seed: this._seed,
            _ratio: this._ratio,
        }
    }

    public static fromJSON(
        element: ExportedScalableBloomFilter
    ): ScalableBloomFilter {
        const bl = new ScalableBloomFilter(
            element._initial_size,
            element._error_rate,
            element._ratio
        )
        bl.seed = element._seed
        bl._filters = element._filters.map(filter =>
            PartitionBloomFilter.fromJSON(filter)
        )
        return bl
    }
}
