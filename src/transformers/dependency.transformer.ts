import jsc, { ASTPath } from "jscodeshift";

/**
 * This is not like the other transformers. This is more used as a method of logically grouping
 * together multiple related methods for handling parsing/stripping/etc dependencies
 */
class DependencyTransformer {
  public transform(node: ASTPath<jsc.ObjectProperty>) {
    /**
     * Step 1: Scan for identifiers. Depending on the identifier do one of two things
     * Step 2: If it's a standalone identifier, find the decorator in it's corresponding package
     *         and then determine it's side by decorator
     * Step 3: If it's a chained identifier, crawl up the chain looking for a method named
     *         side. Then read the argument in this method to determine which side it belongs on.
     *         If one is not defined, assume both sides.
     */
  }
}