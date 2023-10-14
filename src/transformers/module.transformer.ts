import { ModuleAttributes, SidedFieldsConstant, SidedFieldTypesConstant } from "@atomicdesign/atomic-engine";
import { BaseTransformer } from "./base.transformer";
import jsc, { ASTPath, Collection, Node } from 'jscodeshift';
import { ATOMIC_IDENTIFIER_CREATE_MODULE, DEFAULT_FILE_ENCODING, NO_VERSION_DEFAULT } from "../constants";
import fs from 'fs';
import path from 'path';
import { NodePath } from "ast-types/lib/node-path";

export class ModuleTransformer extends BaseTransformer {
  // The AST is the entire file as an AST
  public ast: Collection;
  // The Module AST is specifically the Object Expression defining the module info
  public moduleAst: Collection;

  public moduleLocation: string;
  public highestDir = process.cwd();

  public cachedVersion: string | null; 

  transform(id: string, code: string): Collection<any> {
    this.ast = jsc.withParser(this.config.jsCodeParser)(code);
    this.moduleLocation = id;

    this.getModuleAST();

    /**
     * If the disabled attribute was not found, then we're going to look at
     * each attribute found, and compare it to our `sided-fields.constant`
     * object from AtomicEngine. We can compile a list of attributes to strip
     * all identifiers from this way
     */
    let attributesToRemove: {[key: string]: SidedFieldTypesConstant} = {};
    if (this.getIsDisabled()) {
      // Get all attributes that are not Name or Version, and mark them for stripping.
      this.moduleAst
        .find(jsc.ObjectProperty)
        .filter(node => !this.isNeverStrippedAttribute(node))
        .forEach(node => attributesToRemove[this.getPropertyName(node)] = SidedFieldTypesConstant.Neither);
      this.log("Disabled");
    } else {
      // Get all attributes that are not Name, Version, or correct for this side and mark them for processing/stripping
      this.moduleAst
        .find(jsc.ObjectProperty)
        .filter(node => this.hasCreateModuleGrandparent(node) && this.isStrippedAttribute(node))
        .forEach(node => attributesToRemove[this.getPropertyName(node)] = SidedFieldsConstant[this.getPropertyName(node)]);
      this.log("Enabled");
    }


    for (let [key, value] of Object.entries(attributesToRemove)) {
      this.debug(`Checking property ${key} with sided type ${value}`);
  
      // Find the matching node. There should be exactly one.
      const node = this.moduleAst
        .find(jsc.ObjectProperty, {key: {name: key}});
  
      // Conditionally strip it depending on the type it was marked.
      if (value === SidedFieldTypesConstant.DecoratorDefined) {
        this.stripDecoratorPropertyNode(node)
      } else {
        // Prune all sub nodes that extend off this one.
        node.forEach(subNode => subNode.prune());
      }
    }
  
    this.stripDeadImports(this.ast);

    return this.ast;
  }

  private getIsDisabled(): boolean {
    return this.moduleAst
      .find(jsc.ObjectProperty, {key: {name: ModuleAttributes.Disabled}, value: {value: true}})
      .length > 0;
  }
  
  private getModuleName(): string {
    // First look through the AST for a identifier 'createModule', and then
    // look at the Object Expression that was passed in
    return this.moduleAst
      .find(jsc.ObjectProperty, {key: {name: ModuleAttributes.Name}})
      .get("value", "value")?.value ?? this.moduleLocation.split("/").pop().replace(".module.ts", "");
  }

  /**
   * Attempt to return the module version from the module file. If we can't find
   * a version, then we will look for the package.json and look for it's version.
   * If there's still no version, then we'll return 0.0.0.
   * @returns The Module Version (where applicable)
   */
  private getModuleVersion(): string {
    if (this.cachedVersion) {
      return this.cachedVersion;
    }

    const moduleVersionNode = this.moduleAst
      .find(jsc.ObjectProperty, {key: {name: ModuleAttributes.Version}})
      
    if (moduleVersionNode.length > 0) {
      this.cachedVersion = moduleVersionNode.get("value", "value")?.value;
    } else {
      // TODO: Add a way to get the version from a parent as well
      this.cachedVersion = this.fallbackAttemptToGetVersion();
    }
    return this.cachedVersion ?? NO_VERSION_DEFAULT;
  }

  /**
   * TODO: Climb directories looking for a package.json, and read the
   * package.json for a version.
   */
  private fallbackAttemptToGetVersion(): string | null {
    // Crawl upward looking for a package.json. Don't go higher than the NODE directory
    const timesToTryUp = this.moduleLocation.split("/").length;
    let currentDir = this.moduleLocation;
    let idx = 0;
    while (idx < timesToTryUp) {
      idx = idx++;
      currentDir = this.normalizedJoin(currentDir, "..");
      if (currentDir === this.defaultNodeDirectoryToUse) {
        return;
      }
      if (fs.existsSync(`${currentDir}/package.json`)) {
        const contents = fs.readFileSync(`${currentDir}/package.json`, DEFAULT_FILE_ENCODING);
        const asJson = JSON.parse(contents);
        if (asJson?.version) {
          const version = asJson?.version;

          // Add it as a property to our AST, so that the frontend sees the version too
          const newVersionNode = jsc.objectProperty(jsc.identifier(ModuleAttributes.Version), jsc.stringLiteral(version));
          this.moduleAst.nodes().push(newVersionNode);

          return version;
        }
      }
    }
  }

  /**
   * Scan the dependencies in the providers section, and strip dependencies that need
   * to be removed. 
   * @param node 
   */
  private stripDepedencyIdentifiers(node: ASTPath<jsc.ObjectProperty>): void {
    
  }

  /**
   * Make sure this object property node isn't Name or Version
   * @param node 
   * @returns 
   */
  private isNeverStrippedAttribute(node: ASTPath<jsc.ObjectProperty>): boolean {
    return this.getPropertyName(node) !== ModuleAttributes.Name
      && this.getPropertyName(node) !== ModuleAttributes.Version;
  }

  private getPropertyName(node: ASTPath<jsc.ObjectProperty>) {
    return node.getValueProperty("key")["name"];
  }

  /**
   * Check if this object property is one of the types that should be processed.
   * @param node 
   * @param side 
   * @returns 
   */
  private isStrippedAttribute(node: ASTPath<jsc.ObjectProperty>): boolean {
    const nodeName = this.getPropertyName(node);
    const sideValue: SidedFieldTypesConstant = SidedFieldsConstant[nodeName];

    // Anything marked as neither should be marked to be stripped
    if (sideValue === SidedFieldTypesConstant.Neither) {
      return true;
    }

    if (sideValue === SidedFieldTypesConstant.Client && this.isServer()){
      // If we're on the server, and an attribute is marked as client, then we should strip it
      return true;
    } else if (sideValue === SidedFieldTypesConstant.Server && this.isClient()) {
      // If we're on the client, and an attribute is marked as server, then we should strip it
      return true;
    } else if (sideValue === SidedFieldTypesConstant.DecoratorDefined) {
      return true;
    }

    // This attribute *does not* need to be conditionally checked, or straight up removed. 
    // This should be the case for things marked as Both, or things on the correct side
    return false;
  }

  /**
   * Given a Object Property that contains an array of identifiers, find each
   * identifier, locate the orignating file, and find which side the identifier
   * is allowed to run on, via the Decorator it uses. 
   * @param node 
   * @param attributeName 
   */
  private stripDecoratorPropertyNode(node: Collection) {
    node
      .forEach(matchingProperty => {
        const identifiersToRemove: string[] = [];

        // Find identifiers in our property
        // Should I be using JSC for this?
        const identifiers: Node[] = matchingProperty.getValueProperty("value").elements;

        // For each identifier we should find the originating file
        // and see which side it's allowed to run on
        identifiers.forEach((idNode) => {
          this.ast
            .find(jsc.ImportDeclaration)
            .filter(decl => this.getImportIdentifiers(decl).includes(idNode["name"]))
            .forEach(importFound => {
              // Start our search from the directory of the module
              // TODO: Maybe this should take into account more info about the import?
              const baseDir = this.normalizedJoin(this.moduleLocation, "..", <string>importFound.value.source.value);
              let location = this.crawlModuleForIdentifier(baseDir, idNode["name"]);

              // Load the new file, and create our new AST
              const file = fs.readFileSync(location, DEFAULT_FILE_ENCODING);
              const fileAst = jsc.withParser(this.config.jsCodeParser)(file);

              // Look for the identifier in our new file
              fileAst
                // Filter by Class Declarations that have a matching identifier
                .find(jsc.ClassDeclaration, {id: {name: idNode["name"]}})
                .forEach(node => {
                  // Get the side from any decorators that can mark the side
                  const side = this.getResourceSideFromDecorators(node.getValueProperty("decorators"));
                  this.debug(`${idNode["name"]} is designated for side ${side}`);

                  // Check the current side vs the side that was specified, and potentially
                  // mark this identifier to be removed
                  if (this.isServer() && this.isValueServer(side)) {
                    identifiersToRemove.push(idNode["name"])
                  } else if (this.isClient() && this.isValueClient(side)) {
                    identifiersToRemove.push(idNode["name"])
                  }
                });
            })
        });

        // Filter the elements on our property from the module based on whether or not
        // the above process marked the identifier to be removed
        matchingProperty.value.value.elements = identifiers
          .filter(allowed => identifiersToRemove.includes(allowed["name"]))
      })
  }

  /**
   * Check to make sure a node has the createModule function as it's grandparent. This 
   * is used to help filter out object expressions
   * @param node 
   * @returns 
   */
  private hasCreateModuleGrandparent(node: ASTPath) {
    const grandparent = node.parent.parent;
    return grandparent.getValueProperty("callee")?.name === ATOMIC_IDENTIFIER_CREATE_MODULE;
  }

  /**
   * Get the side for a resource from decorators defined on it. This currently
   * only works for SetSidedResource and Provide decorators.
   * @param decorators 
   * @returns 
   */
  private getResourceSideFromDecorators(decorators: Node[]): string {
    // No decorators found
    if (!decorators || decorators.length === 0) {
      return "BOTH";
    }
    // Decorators found. Should check for our specific decorators
    for (let decorator of decorators) {
      const expression = decorator["expression"];
      const callee = expression["callee"];
      const args = expression["arguments"];
      if (callee["name"] === "SetSidedResource") {
        const objFromArgs = args[0];
        return objFromArgs.property.name.toLowerCase();
      } else if (callee["name"] === "Provide") {
        const objFromArgs = args[0]["properties"];
        const sideNode = objFromArgs.find(prop => prop.key.name === "side");
        return sideNode.value.property.name.toLowerCase();
      }
    }

    // We didn't have any of our decorators
    return "BOTH";
  }

  private getModuleAST(): void {
    this.moduleAst = this.ast
      .find(jsc.CallExpression, {callee: {name: ATOMIC_IDENTIFIER_CREATE_MODULE}})
      .find(jsc.ObjectExpression);

    this.getModuleName();
    this.getModuleVersion();
  }

  //#region Log message overrides
  protected override log(message: string) {
    super.log(this.formatMessage(message));
  }

  protected override debug(message: string) {
    super.debug(this.formatMessage(message));
  }

  protected formatMessage(message: string): string {
    if (!!this.moduleAst) {
      return `[${this.getModuleName()}] [${this.getModuleVersion()}] ${message}`;
    }
    return message;
  }
  //#endregion
}