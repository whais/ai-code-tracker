/**
 * VSCode 测试框架全局类型声明
 * 声明 suite 和 test 等全局函数
 */

declare function suite(name: string, fn: (this: Mocha.Suite) => void): Mocha.Suite;
declare function suite<T>(name: string, fn: (this: Mocha.Suite, ctx: T) => void): Mocha.Suite;

declare function test(name: string, fn?: Mocha.Func): Mocha.Test;
declare function test(name: string, fn?: Mocha.AsyncFunc): Mocha.Test;

// 重导出 Mocha 类型以便使用
/// <reference types="mocha" />
