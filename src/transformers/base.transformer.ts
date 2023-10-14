// import { Logger, SIDE } from "@atomicdesign/atomic-engine";
import jsc from 'jscodeshift';
import fs from 'fs';
import path from 'path';
import { ASTPath, Collection, Identifier, ImportDeclaration } from "jscodeshift";
import { AtomicEngineConfig } from "../interfaces/config.interface";
import { DEFAULT_FILE_ENCODING, NODE_MODULES } from "../constants";
import { BuildLogService } from "@/services/build-log.service";
import { normalizePath } from "vite";
import { namedTypes } from "ast-types"

export abstract class BaseTransformer {
  protected nodeModuleDirectoriesChecked: {[isValid: string]: boolean} = {};
  protected defaultNodeDirectoryToUse: string = "";

  constructor(
    public logger: BuildLogService,
    public side: string,
    public config: AtomicEngineConfig
  ) {}

  abstract transform(id: string, code: string): Collection;

  protected log(message: string) {
    this.logger.info(message);
  }

  protected debug(message: string) {
    this.logger.debug(message);
  }

  /**
   * The below methods don't really belong here, but they're used in both transformers
   * and kind of complicated, so here we go. For now.
   */
  //#region Helper methods

  /**
   * Search for node_module directories, starting at a specified path. Additionally
   * cache the results of each path discovery.
   * @param startingDirectory The directory to start our search at
   * @returns A list of valid node_module paths discovered
   */
  protected resolveNodeModuleFolders(startingDirectory: string): string[] {
    // Accept a custom environment variable resolution. Otherwise
    // we implement a simple search for it. 
    // TODO: Above

    // Go up a directory, and check for a node_modules folder. Do this
    // recursively until we can't go up further. For each time we do find
    // a node_modules directory, take the count of how many folders are in
    // it. We can use that count to sort by, and determine which folders
    // to look in first. Additionally we should try to give priority
    // to folders lower in the structure, since those are more likely to
    // be project folders.
    // TODO: Implement the sort.
    const result = [];

    const timesToGoUp = startingDirectory.split(path.sep).length;
    let counter = startingDirectory.split(path.sep).length;

    while (counter > 1) {
      counter = counter - 1;
      const diff = timesToGoUp - counter;

      let pathString = startingDirectory;
      for (let i = 0; i < diff; i++) {
        pathString = this.normalizedJoin(pathString, "..");
      }

      // Resolve to the node_modules directory here, if there is one. Make sure
      // we're using a posix compatible path.
      pathString = normalizePath(path.resolve(this.normalizedJoin(pathString, NODE_MODULES)));

      // logger.this.debug(`Checking path directory: ${pathString}`);
      // TODO: Add caching tree in
      if (fs.existsSync(pathString)) {
        // logger.this.debug(`Found valid path directory: ${pathString}`);
        result.push(pathString);
        this.nodeModuleDirectoriesChecked[pathString] = true;
      } else {
        this.nodeModuleDirectoriesChecked[pathString] = false;
      }
    }

    return result;
  }

  /**
   * Find the path of a given package in our known node_module folders
   * @param packageName The package name
   * @returns The posix compliant package path
   */
  protected resolvePackageInNodeModules(
    packageName: string
  ): string {
    const posixPackageName = normalizePath(packageName);

    if (!!this.defaultNodeDirectoryToUse) {
      const packagePath = this.normalizedJoin(this.defaultNodeDirectoryToUse, posixPackageName);
      if (fs.existsSync(packagePath)) {
        return packagePath;
      }
    }

    const nodeModuleFolders = this.resolveNodeModuleFolders(process.cwd());
    const foundPath = nodeModuleFolders
      .map(folderPath => this.normalizedJoin(folderPath, posixPackageName))
      .find(newPath => fs.existsSync(newPath))

    this.defaultNodeDirectoryToUse = `${foundPath}`.replace(posixPackageName, '');
    this.debug(`Found new default node_module directory: ${this.defaultNodeDirectoryToUse}`);

    return foundPath ?? "";
  }


  // TODO: This could implement an in-memory cache to be more performant when looking
  //       for other services/etc
  /**
   * Search a module for the file path the given identifier originates from. This will
   * recursively scan a module by searching through exports to find the identifier.
   * @param startingPath The directory to start in.
   * @param identifierName The name of the identifier we're looking for.
   * @param fileExtension The assumed file extension to check for
   * @returns The path to the file where the identifier was found, or null if it wasn't found.
   */
  protected crawlModuleForIdentifier(
    startingPath: string,
    identifierName: string,
    fileExtension="ts"
  ): string | null {
    let startingTarget = startingPath;

    // Determine if this is a file, or if this is a directory and we need to unpack barrel imports
    if (!startingTarget.endsWith(`.${fileExtension}`)) {
      // Check to see if this is a file, or a directory.
      // This only needs to happen if the import doesn't include an extension
      // TODO: Add extension configurability
      if (!fs.existsSync(`${startingTarget}.${fileExtension}`)) {
        startingTarget = `${startingTarget}/index.${fileExtension}`;
        this.debug(`${identifierName} comes from a barrel import. Changed location to: ${startingTarget}`);
      } else {
        startingTarget = `${startingTarget}.ts`;
        this.debug(`${identifierName} comes from a file. Changed location to: ${startingTarget}`);
      }
    }

    // Load the file, and then load it's AST
    const fileContents = fs.readFileSync(startingTarget, DEFAULT_FILE_ENCODING);
    // logger.this.debug(`Opening file: ${startingTarget}`);
    const ast = jsc.withParser(this.config.jsCodeParser)(fileContents);

    // Check to see if we import the identifier in this file, and use it.
    // Using the identifier will throw a false positive, so we short circuit
    // this iteration and continue following the identifier import path
    const hasImportIdentifiers = ast
      .find(jsc.Identifier, {name: identifierName})
      .filter(node => !this.isNotChildOfImport(node))

    // If we have imports for this identifier in this file, we should
    // try to follow the path
    if (hasImportIdentifiers.length > 0) {
      // This should be fine, since the identifier should only ever match one import
      const importPath = this.getImportPath(hasImportIdentifiers.paths()[0]);
      this.debug(`Found current file ${startingTarget} imports ${identifierName} from ${importPath}`);

      // Check if the path used is relative
      if (this.isImportPathRelative(importPath)) {
        // Go up a directory from the current file, and then resolve our new path from
        // the importPath of the Import Declaration
        let newPath = this.normalizedJoin(startingPath, "..", importPath);
        // Check if this is a file or directory, since we could do either
        if (fs.existsSync(`${newPath}.${fileExtension}`)) {
          // This was a file, so let's explicitly check the file
          newPath = `${newPath}.${fileExtension}`;
          this.debug(`Checking new path recursively: ${newPath}`);
          return this.crawlModuleForIdentifier(newPath, identifierName, fileExtension);
        } 
        // This was a directory, so we can apply normal recursion logic to it
        this.debug(`Checking new path recursively: ${newPath}`);
        return this.crawlModuleForIdentifier(newPath, identifierName, fileExtension);
      } else {
        // This was a non-relative import, so we should look for this in our
        // node_modules folder
        let newPath = this.normalizedJoin(this.defaultNodeDirectoryToUse, importPath);
        return this.crawlModuleForIdentifier(newPath, identifierName, fileExtension);
      }
    }

    // Using the AST look for instances of the identifier where
    // we have a plain definition
    const found = ast
      .find(jsc.Identifier, {name: identifierName})

    // This file contains the identifier we're looking for
    if (found.length > 0) {
      this.debug(`Found target specifier as Identifier in: ${startingTarget}`);
      return startingTarget;
    }

    // If no identifier, look for other exports. We'll recursively search those.
    // First check for specific export. This is where our export could show up 
    // if this isn't a barrel import file 
    // TODO: We may not need this at all, since the above already scans for
    //       an identifier
    let allIdentifiers: Array<string> = [];
    // Otherwise, look for export all identifiers
    const exportAlls = ast.find(jsc.ExportAllDeclaration)
      .forEach((decl) => allIdentifiers = allIdentifiers.concat(decl.node.source.value));

    for (const filePath of allIdentifiers) {
      this.debug(`Further examining imports recursively: ${filePath}`);

      let newPath = "";
      const normalizedPath = this.normalizedJoin(startingPath, filePath)
      // Check to see if this path is a directory or file
      if (fs.existsSync(normalizedPath)) {
        newPath = `${normalizedPath}/index.${fileExtension}`;
      } else {
        newPath = `${normalizedPath}.${fileExtension}`;
      }

      this.debug(`FQ Path: ${newPath}`);
      // this.debug(`Searching for ${identifierName}`);
      const matched = this.crawlModuleForIdentifier(newPath, identifierName, fileExtension);
      if (!!matched) {
        return matched;
      }
    }

    return null;
  }

  /**
   * Helper shortcut to see if the given value for a side is the server
   * @param side 
   * @returns true/false
   */
  protected isValueServer(side: string): boolean {
    return side.toLowerCase() === SIDE.Server || side.toLowerCase() === SIDE.Both;
  }

  /**
   * Helper shortcut to see if the given value for a side is the client
   * @param side 
   * @returns true/false
   */
  protected isValueClient(side: string): boolean {
    return side.toLowerCase() === SIDE.Client || side.toLowerCase() === SIDE.Both;;
  }

  protected isServer() {
    return this.isValueServer(this.side);
  }

  protected isClient() {
    return this.isValueClient(this.side);
  }

  /**
   * Scan the AST for import identifiers. Then scan for a place each
   * import identifier is used. Prune any import identifiers that are
   * not used. This is basically rudimentary tree shaking for a single file.
   * @param root 
   */
  protected stripDeadImports(root: Collection<any>) {
    this.debug('Stripping dead imports');

    // TODO: Why does this run twice per identifier?
    root
      .find(jsc.ImportDeclaration)
      .find(jsc.Identifier)
      .forEach(identifier => {
        // See if we can find a usage of the identifier that's not
        // somehow an import
        const isNotUsed = root
          .find(jsc.Identifier, {name: identifier.getValueProperty("name")})
          .filter(subNode => this.isNotChildOfImport(subNode))
          .length === 0;

        if (isNotUsed) {
          this.debug(`Pruning identifier: ${identifier.getValueProperty("name")}`);
          const parent = identifier.parent;
          if (parent.getValueProperty("type") === "ImportDefaultSpecifier"){
            parent.prune();
          } else if (parent.getValueProperty("type") === "ImportSpecifier") {
            // The Grandparent is the root import node
            const grandparent = parent.parent;
            // We can pre-emptively prune the identifier
            identifier.prune();

            // Identifiers that are pruned aren't removed from the
            // specifier node until later. Manually updating this
            // allows us to keep track of how many imports are still
            // valid
            grandparent.value.specifiers = grandparent.value.specifiers
              .filter(nodeInGrandparent => !!nodeInGrandparent.imported)

            // If there are no valid imports left, then we should prune
            // the entire grandparent
            if (grandparent.value.specifiers?.length === 0) {
              grandparent.prune();
            }
          }
        }
      })
  }

  /**
   * Check if the parent node is an import specifier node
   * @param node 
   * @returns 
   */
  protected isNotChildOfImport(node: ASTPath<Identifier>) {
    return node.parent.getValueProperty("type") !== "ImportSpecifier"
      && node.parent.getValueProperty("type") !== "ImportDefaultSpecifier"
  }

  /**
   * Get the import path defined in an ImportDeclaration
   * @param node The identifier we're currently finding the import from
   * @returns The path being imported from
   */
  protected getImportPath(node: ASTPath<Identifier>): string {
    let importDecl;
    if (node.parent.getValueProperty("type") === "ImportSpecifier") {
      importDecl = node.parent.parent;
    } else if (node.parent.getValueProperty("type") === "ImportDefaultSpecifier") {
      importDecl = node.parent;
    } else {
      this.logger.error("Failed to find import path from an import identifier");
      throw new Error("Failed to find import path from an import identifier");
    }
    return importDecl.getValueProperty("source").value;
  }

  /**
   * Simple check to see if the path starts with ./ or ../
   * @param path 
   * @returns 
   */
  protected isImportPathRelative(path: string): boolean {
    return path.startsWith("./") || path.startsWith("../");
  }

  /**
   * Retrieve all import identifiers from an ImportDeclaration node
   * @param node 
   * @returns 
   */
  protected getImportIdentifiers(node: ASTPath<ImportDeclaration>): string[] {
    const specifiers = node.getValueProperty("specifiers");
    return specifiers.map(specNode => {
      return specNode.local.name;
    })
  }

  protected normalizedJoin(...paths: string[]) {
    return normalizePath(path.join(...paths));
  }
  //#endregion
}