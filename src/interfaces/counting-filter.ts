/**
 * A filter that can count occurrences of items and estimate their frequencies.
 * @author Thomas Minier
 * @author Arnaud Grall
 */
export default interface CountingFilter<T> {
    /**
     * Update the count min sketch with a new occurrence of an element
     * @param element - The new element
     * @param count - Number of occurrences of the elemnt (defauls to one)
     */
    update(element: T, count: number): void

    /**
     * Perform a point query: estimate the number of occurrence of an element
     * @param element - The element we want to count
     * @return The estimate number of occurrence of the element
     */
    count(element: T): number
}
