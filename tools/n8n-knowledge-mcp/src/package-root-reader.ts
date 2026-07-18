import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export type PackageRootReader = {
  root: string;
  readText(sourcePath: string, context: string): Promise<string>;
  readTextIfExists(sourcePath: string, context: string): Promise<string | null>;
};

export async function createPackageRootReader(
  packageName: string,
  packageDirectory: string,
): Promise<PackageRootReader> {
  let root: string;
  try {
    root = await realpath(packageDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `${packageName}: package directory ${packageDirectory} does not exist`,
        { cause: error },
      );
    }
    throw new Error(
      `${packageName}: failed to resolve package directory ${packageDirectory}`,
      { cause: error },
    );
  }

  async function resolveContained(
    sourcePath: string,
    context: string,
    optional: boolean,
  ): Promise<string | null> {
    if (isAbsolute(sourcePath)) {
      throw outsidePackageError(packageName, context, sourcePath);
    }

    const lexicalTarget = resolve(root, sourcePath);
    assertContained(packageName, root, lexicalTarget, context, sourcePath);

    let resolvedTarget: string;
    try {
      resolvedTarget = await realpath(lexicalTarget);
    } catch (error) {
      if (optional && (error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error(
        `${packageName}: failed to resolve ${context} ${sourcePath}`,
        { cause: error },
      );
    }
    assertContained(packageName, root, resolvedTarget, context, sourcePath);
    return resolvedTarget;
  }

  return {
    root,
    async readText(sourcePath: string, context: string): Promise<string> {
      const target = await resolveContained(sourcePath, context, false);
      return await readFile(target!, "utf8");
    },
    async readTextIfExists(sourcePath: string, context: string): Promise<string | null> {
      const target = await resolveContained(sourcePath, context, true);
      return target ? await readFile(target, "utf8") : null;
    },
  };
}

function assertContained(
  packageName: string,
  root: string,
  target: string,
  context: string,
  sourcePath: string,
): void {
  const relativeTarget = relative(root, target);
  if (
    relativeTarget === ".." ||
    relativeTarget.startsWith(`..${sep}`) ||
    isAbsolute(relativeTarget)
  ) {
    throw outsidePackageError(packageName, context, sourcePath);
  }
}

function outsidePackageError(
  packageName: string,
  context: string,
  sourcePath: string,
): Error {
  return new Error(
    `${packageName}: ${context} ${sourcePath} resolves outside the package root`,
  );
}
