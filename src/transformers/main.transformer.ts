import { BaseTransformer } from "./base.transformer";
import jsc, { ASTNode, ASTPath, CallExpression, Collection, MemberExpression } from 'jscodeshift';
import { ATOMIC_IDENTIFIER_LOADER_DECORATOR, ATOMIC_IDENTIFIER_USE_API, ATOMIC_IDENTIFIER_USE_LOADER, DEFAULT_FILE_ENCODING, SIDE_KEY } from "../constants";

import fs from 'fs';

export class MainTransformer extends BaseTransformer {
  public ast: Collection;

  transform(id: string, code: string): Collection<any> {
    const parsedCode = jsc.withParser(this.config.jsCodeParser)(code);

    const loaderIdentifiersToFix: string[] = [];
    parsedCode.find(jsc.CallExpression, {callee: { property: {name: ATOMIC_IDENTIFIER_USE_LOADER} }})
      .forEach((expression) => {
        const loaderIdentifier = expression.node.arguments[0]["name"];
        this.debug(`Loader identified: ${loaderIdentifier}`);
  
        parsedCode.find(jsc.ImportDeclaration, {
          specifiers: [
            {
              imported: {
                type: 'Identifier',
                name: loaderIdentifier
              }
            }
          ]
        }).forEach((importNode) => {
          // For each loader, we want to open the file, and analyze the identifier
          // to see if the decorator contained specifies it as server or client side
          const identifier = importNode.node.specifiers[0].local.name;
          const location = importNode.node.source.value.toString();
          this.debug(`Preparing to examine identifier: ${identifier} from ${location}`);
  
          const fqpath = this.resolvePackageInNodeModules(location);
          this.debug(`Found package in ${fqpath}`);
  
          const identifierFoundIn = this.crawlModuleForIdentifier(fqpath, identifier);
          this.debug(`Found identifier in: ${identifierFoundIn}`);
  
          // Found the correct file, now we need to look for the decorator
          const data = fs.readFileSync(identifierFoundIn, DEFAULT_FILE_ENCODING);
          const loaderFile = jsc.withParser(this.config.jsCodeParser)(data);
  
          let sideForObject: string;
  
          // Find the Named Export this is defined in, then grab it's decorator nodes
          // and filter the value down to our Loader Decorator value
          loaderFile.find(jsc.ExportNamedDeclaration, {declaration: {id: {name: identifier}}})
            .forEach(path => {
              //this.debug(path.node);
              if (path.node.declaration["decorators"]?.length > 0) {
                // Find decorators on the class for Loader Definition
                const loaderDecorators = path.node.declaration["decorators"]
                  .find((nodePath: any) => nodePath.expression.callee.name === ATOMIC_IDENTIFIER_LOADER_DECORATOR);
  
                // Look through the arguments for one that contains the Side definition
                const objectArgumentWithSide = 
                  loaderDecorators.expression.arguments
                    .find((argument: any) => argument.properties.find(property => property.key.name === SIDE_KEY));
  
                // Actuallly fetch that object definition
                const objectSideDefinition = objectArgumentWithSide.properties.find(property => property.key.name === SIDE_KEY);
  
                // Get the side in the object definition
                sideForObject = objectSideDefinition.value.property.name;
                return true;
              }
            })
  
          // The side for this loader is incorrect, so we want to mark it to be pruned.
          if (sideForObject.toLowerCase() !== this.side.toLowerCase()) {
            this.debug(`Incorrect side (${sideForObject} != ${this.side}) for ${loaderIdentifier}`);
            expression.prune();
            importNode.prune();
          } else {
            if (!loaderIdentifiersToFix.includes(loaderIdentifier)){
              loaderIdentifiersToFix.push(loaderIdentifier);
            }
          }
        })
      })
      /**
       * TODO: This needs to be fixed, as this is a bandaid currently. Removing
       * or replacing the useLoader expressions will orphan the original 
       * useAtomicApi() call. This adds it back at the bottom of the tree. The
       * gotcha to doing this is that if the code isn't structured in such a way
       * where we chain useAtomicApi() with the useLoader() calls immediately
       * then anything inbetween the useLoader calls will be deleted.
       */
      .replaceWith(this.regenerateLoaderCallExpressions(loaderIdentifiersToFix))
  
      return parsedCode;
  }

  /**
   * Generate a new AST Node containing the Member Expressions
   * and Call Expressions for daisy chaining the useAtomicApi
   * and useLoader calls.
   * @param allowedLoaders. An array of loaders to generate calls for. This should be an array of strings.
   * @returns An AST Node properly containing the daisy chain for calls removed when replacing loader nodes.
   */
  private regenerateLoaderCallExpressions(allowedLoaders: string[]): ASTNode {
    let lastIdentifierToChain: CallExpression | MemberExpression = jsc.callExpression(jsc.identifier(ATOMIC_IDENTIFIER_USE_API), []);
    allowedLoaders.forEach(loaderName => {
      lastIdentifierToChain = jsc.memberExpression(lastIdentifierToChain, jsc.callExpression(jsc.identifier(ATOMIC_IDENTIFIER_USE_LOADER), [jsc.identifier(loaderName)]))
    });
    return lastIdentifierToChain;
  }
}