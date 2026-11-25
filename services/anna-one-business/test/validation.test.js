import test from 'node:test';
import assert from 'node:assert/strict';
import { validCpf,validCnpj } from '../src/index.js';
test('CPF',()=>{assert.equal(validCpf('52998224725'),true);assert.equal(validCpf('52998224724'),false);assert.equal(validCpf('00000000000'),false);});
test('CNPJ numérico e alfanumérico',()=>{assert.equal(validCnpj('11222333000181'),true);assert.equal(validCnpj('12ABC34501DE35'),true);assert.equal(validCnpj('12ABC34501DE34'),false);assert.equal(validCnpj('00000000000000'),false);});
